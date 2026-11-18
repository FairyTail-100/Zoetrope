import {
  CEPK_HEADER_SIZE,
  CEPK_RECORD_SIZE,
  CEPK_VERSION,
  CEPKRecord,
} from '@zoetropejs/manifest';

export interface UnpackedPack {
  version: number;
  frames: Map<number, Uint8Array>;
  verifyPayloadChecksums?: () => void;
}

// Precomputed CRC32 lookup table (IEEE 802.3 standard)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCRC32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Validates and unpacks a CEPK binary chunk into individual frame byte buffers.
 * verifyMode:
 *   - 'full' / true: synchronously verify header CRC32 and every frame payload CRC32
 *   - 'header-only': verify header CRC32 on hot path, defer payload CRC32 off hot path
 *   - false: skip CRC32 checks
 */
export function unpackCEPK(
  source: ArrayBuffer | ArrayBufferView,
  verifyChecksums: boolean | 'full' | 'header-only' = true
): UnpackedPack {
  const byteOffset = ArrayBuffer.isView(source) ? source.byteOffset : 0;
  const byteLength = ArrayBuffer.isView(source) ? source.byteLength : source.byteLength;
  const buffer = ArrayBuffer.isView(source) ? source.buffer : source;

  if (byteLength < CEPK_HEADER_SIZE) {
    throw new Error(`Buffer too small for CEPK header: ${byteLength} bytes`);
  }

  const bytes = new Uint8Array(buffer, byteOffset, byteLength);

  // Endian-safe magic check: 'C', 'E', 'P', 'K'
  if (
    bytes[0] !== 0x43 || // 'C'
    bytes[1] !== 0x45 || // 'E'
    bytes[2] !== 0x50 || // 'P'
    bytes[3] !== 0x4b    // 'K'
  ) {
    throw new Error(
      `Invalid CEPK magic bytes: [${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${bytes[3]}]. Expected 'CEPK'`
    );
  }

  const dv = new DataView(buffer, byteOffset, byteLength);
  const version = dv.getUint16(4, true);
  if (version !== CEPK_VERSION) {
    throw new Error(`Unsupported CEPK version: ${version}. Expected ${CEPK_VERSION}`);
  }

  const _flags = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  const headerCrc = dv.getUint32(12, true);

  const shouldVerifyHeader = verifyChecksums === true || verifyChecksums === 'full' || verifyChecksums === 'header-only';
  const shouldVerifyPayload = verifyChecksums === true || verifyChecksums === 'full';

  if (shouldVerifyHeader) {
    const computedHeaderCrc = computeCRC32(bytes.subarray(0, 12));
    if (computedHeaderCrc !== headerCrc) {
      throw new Error(`Corrupted CEPK header CRC32 mismatch: expected ${headerCrc}, got ${computedHeaderCrc}`);
    }
  }

  const tableSize = count * CEPK_RECORD_SIZE;
  const payloadStartOffset = CEPK_HEADER_SIZE + tableSize;

  if (byteLength < payloadStartOffset) {
    throw new Error(
      `Corrupted CEPK buffer: length ${byteLength} is smaller than header + index table ${payloadStartOffset}`
    );
  }

  const frames = new Map<number, Uint8Array>();
  const payloadValidationQueue: Array<{ frameIndex: number; data: Uint8Array; expectedCrc: number }> = [];

  for (let i = 0; i < count; i++) {
    const recordOffset = CEPK_HEADER_SIZE + i * CEPK_RECORD_SIZE;
    const frameIndex = dv.getUint32(recordOffset, true);
    const frameRelOffset = dv.getUint32(recordOffset + 4, true);
    const frameByteLength = dv.getUint32(recordOffset + 8, true);
    const expectedFrameCrc = dv.getUint32(recordOffset + 12, true);

    const absOffset = payloadStartOffset + frameRelOffset;
    if (absOffset + frameByteLength > byteLength) {
      throw new Error(
        `Corrupted CEPK record for frame ${frameIndex}: payload bounds [${absOffset}, ${absOffset + frameByteLength}] exceed file size ${byteLength}`
      );
    }

    // Zero-copy view using subarray
    const frameBytes = bytes.subarray(absOffset, absOffset + frameByteLength);

    if (shouldVerifyPayload) {
      const computedFrameCrc = computeCRC32(frameBytes);
      if (computedFrameCrc !== expectedFrameCrc) {
        throw new Error(
          `Corrupted frame payload CRC32 mismatch for frame ${frameIndex}: expected ${expectedFrameCrc}, got ${computedFrameCrc}`
        );
      }
    } else {
      payloadValidationQueue.push({ frameIndex, data: frameBytes, expectedCrc: expectedFrameCrc });
    }

    frames.set(frameIndex, frameBytes);
  }

  const verifyPayloadChecksums = () => {
    for (const item of payloadValidationQueue) {
      const computed = computeCRC32(item.data);
      if (computed !== item.expectedCrc) {
        throw new Error(`Corrupted frame payload CRC32 mismatch for frame ${item.frameIndex}`);
      }
    }
  };

  return { version, frames, verifyPayloadChecksums };
}

/**
 * Packs multiple frame buffers into a single CEPK binary container with CRC32 checksums.
 */
export function packCEPK(frames: Array<{ frameIndex: number; data: Uint8Array }>): Uint8Array {
  // Sort frames by index
  const sorted = [...frames].sort((a, b) => a.frameIndex - b.frameIndex);
  const count = sorted.length;

  const tableSize = count * CEPK_RECORD_SIZE;
  const payloadStart = CEPK_HEADER_SIZE + tableSize;

  // Compute total payload size, offsets, and CRC32 checksums
  let totalPayloadSize = 0;
  const records: CEPKRecord[] = [];

  for (const f of sorted) {
    const frameCrc = computeCRC32(f.data);
    records.push({
      frameIndex: f.frameIndex,
      offset: totalPayloadSize,
      byteLength: f.data.byteLength,
      crc32: frameCrc,
    });
    totalPayloadSize += f.data.byteLength;
  }

  const totalBufferSize = payloadStart + totalPayloadSize;
  const output = new Uint8Array(totalBufferSize);
  const dv = new DataView(output.buffer);

  // Write Magic 'CEPK'
  output[0] = 0x43; // 'C'
  output[1] = 0x45; // 'E'
  output[2] = 0x50; // 'P'
  output[3] = 0x4b; // 'K'

  // Write Version & Flags
  dv.setUint16(4, CEPK_VERSION, true);
  dv.setUint16(6, 0, true); // Flags

  // Write Count
  dv.setUint32(8, count, true);

  // Compute and write Header CRC32 (checksum over bytes 0..11)
  const headerCrc = computeCRC32(output.subarray(0, 12));
  dv.setUint32(12, headerCrc, true);

  // Write Index Table
  for (let i = 0; i < count; i++) {
    const recordOffset = CEPK_HEADER_SIZE + i * CEPK_RECORD_SIZE;
    const rec = records[i];
    dv.setUint32(recordOffset, rec.frameIndex, true);
    dv.setUint32(recordOffset + 4, rec.offset, true);
    dv.setUint32(recordOffset + 8, rec.byteLength, true);
    dv.setUint32(recordOffset + 12, rec.crc32, true);
  }

  // Write Payloads
  for (let i = 0; i < count; i++) {
    const rec = records[i];
    const srcData = sorted[i].data;
    output.set(srcData, payloadStart + rec.offset);
  }

  return output;
}
