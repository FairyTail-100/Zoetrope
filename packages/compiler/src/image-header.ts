import * as fs from 'node:fs';

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'webp' | 'jpeg' | 'avif' | 'png' | 'unknown';
}

/**
 * Fast binary image header reader for WebP, JPEG, AVIF, PNG.
 * Reads minimal bytes (<100 bytes) without decoding full pixel raster.
 */
export function readImageDimensions(filePath: string): ImageDimensions {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024);
  const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
  fs.closeSync(fd);

  if (bytesRead < 16) {
    throw new Error('File too small to contain valid image header');
  }

  // 1. WebP (RIFF .... WEBP)
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunkType = buffer.toString('ascii', 12, 16);

    if (chunkType === 'VP8X') {
      // Extended WebP: width at bytes 24-26 (24-bit LE + 1), height at 27-29 (24-bit LE + 1)
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height, format: 'webp' };
    }

    if (chunkType === 'VP8 ') {
      // Simple lossy WebP: start code 0x9D 0x01 0x2A at offset 23
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height, format: 'webp' };
    }

    if (chunkType === 'VP8L') {
      // Lossless WebP: 1-byte signature 0x2F at offset 20, 14-bit width, 14-bit height
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, format: 'webp' };
    }

    return { width: 0, height: 0, format: 'webp' };
  }

  // 2. PNG (\x89PNG\r\n\x1a\n)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height, format: 'png' };
  }

  // 3. JPEG (\xFF\xD8\xFF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < bytesRead - 8) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height, format: 'jpeg' };
      }
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    return { width: 0, height: 0, format: 'jpeg' };
  }

  // 4. AVIF / ISOBMFF (ftypavif)
  if (buffer.toString('ascii', 4, 8) === 'ftyp' && (buffer.toString('ascii', 8, 12) === 'avif' || buffer.toString('ascii', 8, 12) === 'avis')) {
    // Search for 'ispe' box (image spatial extents: width (uint32BE), height (uint32BE))
    const ispeIndex = buffer.indexOf('ispe');
    if (ispeIndex !== -1 && ispeIndex + 12 <= bytesRead) {
      const width = buffer.readUInt32BE(ispeIndex + 8);
      const height = buffer.readUInt32BE(ispeIndex + 12);
      return { width, height, format: 'avif' };
    }
    return { width: 0, height: 0, format: 'avif' };
  }

  return { width: 0, height: 0, format: 'unknown' };
}
