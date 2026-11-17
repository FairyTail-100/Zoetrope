import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { packCEPK, computeCRC32 } from '../packages/streaming/src/binary-pack.js';

describe('CEPK Raw Byte Layout Verification (Manual Byte Assertion)', () => {
  const tmpFile = path.join(process.cwd(), 'temp-layout-test.bin');

  it('generates a binary file matching the exact byte-level specification', () => {
    // 3 distinct payloads
    const payload0 = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const payload1 = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55]);
    const payload2 = new Uint8Array([0x99, 0x88, 0x77]);

    const packed = packCEPK([
      { frameIndex: 10, data: payload0 },
      { frameIndex: 11, data: payload1 },
      { frameIndex: 12, data: payload2 },
    ]);

    fs.writeFileSync(tmpFile, packed);

    try {
      const rawBuf = fs.readFileSync(tmpFile);
      const rawBytes = new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
      const dv = new DataView(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);

      // 1. Header (16 bytes)
      // Bytes 0..3: Magic ASCII 'C', 'E', 'P', 'K'
      expect(rawBytes[0]).toBe(0x43); // 'C'
      expect(rawBytes[1]).toBe(0x45); // 'E'
      expect(rawBytes[2]).toBe(0x50); // 'P'
      expect(rawBytes[3]).toBe(0x4b); // 'K'

      // Bytes 4..5: Version = 1 (Little-Endian)
      expect(dv.getUint16(4, true)).toBe(1);

      // Bytes 6..7: Flags = 0 (Little-Endian)
      expect(dv.getUint16(6, true)).toBe(0);

      // Bytes 8..11: Count = 3 (Little-Endian)
      expect(dv.getUint32(8, true)).toBe(3);

      // Bytes 12..15: Header CRC32 (checksum over bytes 0..11)
      const expectedHeaderCrc = computeCRC32(rawBytes.subarray(0, 12));
      expect(dv.getUint32(12, true)).toBe(expectedHeaderCrc);

      // 2. Record Table (3 * 16 = 48 bytes, starting at offset 16)
      // Record 0 (offset 16): frameIndex=10, offset=0, len=4
      expect(dv.getUint32(16, true)).toBe(10);
      expect(dv.getUint32(20, true)).toBe(0);
      expect(dv.getUint32(24, true)).toBe(4);
      expect(dv.getUint32(28, true)).toBe(computeCRC32(payload0));

      // Record 1 (offset 32): frameIndex=11, offset=4, len=5
      expect(dv.getUint32(32, true)).toBe(11);
      expect(dv.getUint32(36, true)).toBe(4);
      expect(dv.getUint32(40, true)).toBe(5);
      expect(dv.getUint32(44, true)).toBe(computeCRC32(payload1));

      // Record 2 (offset 48): frameIndex=12, offset=9, len=3
      expect(dv.getUint32(48, true)).toBe(12);
      expect(dv.getUint32(52, true)).toBe(9);
      expect(dv.getUint32(56, true)).toBe(3);
      expect(dv.getUint32(60, true)).toBe(computeCRC32(payload2));

      // 3. Payload Block (starts at offset 16 + 3*16 = 64)
      const payloadStart = 64;
      expect(rawBytes.subarray(payloadStart, payloadStart + 4)).toEqual(payload0);
      expect(rawBytes.subarray(payloadStart + 4, payloadStart + 9)).toEqual(payload1);
      expect(rawBytes.subarray(payloadStart + 9, payloadStart + 12)).toEqual(payload2);

      // Total file size
      expect(rawBuf.byteLength).toBe(64 + 4 + 5 + 3);
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });
});
