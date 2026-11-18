import * as fs from 'node:fs';
import * as path from 'node:path';
import { packCEPK } from '@zoetropejs/streaming';
import { ChunkRecord, FrameRecord } from '@zoetropejs/manifest';

export interface PackOptions {
  frameFiles: string[];
  outputChunksDir: string;
  chunkSize?: number; // Frames per chunk (default 24)
  chunkFilePrefix?: string;
  hero?: boolean; // Whether frame 0 is extracted as a standalone hero chunk
}

export interface PackResult {
  chunks: ChunkRecord[];
  totalBytes: number;
}

export function buildChunksFromFiles(options: PackOptions): PackResult {
  const { frameFiles, outputChunksDir, chunkSize = 24, chunkFilePrefix = 'chunk', hero = false } = options;
  fs.mkdirSync(outputChunksDir, { recursive: true });

  const chunks: ChunkRecord[] = [];
  let totalBytes = 0;
  let chunkIndex = 0;

  let fileIndex = 0;

  // If hero mode is active, package frame 0 into a dedicated hero chunk
  if (hero && frameFiles.length > 0) {
    const heroFile = frameFiles[0];
    const fileData = fs.readFileSync(heroFile);
    const heroEntries = [
      {
        frameIndex: 0,
        data: new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength),
      },
    ];
    const packedBytes = packCEPK(heroEntries);
    const heroFileName = `${chunkFilePrefix}_hero.bin`;
    const heroFilePath = path.join(outputChunksDir, heroFileName);
    fs.writeFileSync(heroFilePath, packedBytes);

    chunks.push({
      index: chunkIndex,
      startFrame: 0,
      endFrame: 0,
      src: heroFileName,
      byteLength: packedBytes.byteLength,
      framesCount: 1,
    });

    totalBytes += packedBytes.byteLength;
    chunkIndex++;
    fileIndex = 1;
  }

  while (fileIndex < frameFiles.length) {
    const sliceFiles = frameFiles.slice(fileIndex, fileIndex + chunkSize);
    const startFrame = fileIndex;
    const endFrame = fileIndex + sliceFiles.length - 1;

    const frameEntries = sliceFiles.map((filePath, relIndex) => {
      const frameIndex = startFrame + relIndex;
      const fileData = fs.readFileSync(filePath);
      return {
        frameIndex,
        data: new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength),
      };
    });

    const packedBytes = packCEPK(frameEntries);
    const chunkFileName = `${chunkFilePrefix}_${String(chunkIndex).padStart(3, '0')}.bin`;
    const chunkFilePath = path.join(outputChunksDir, chunkFileName);

    fs.writeFileSync(chunkFilePath, packedBytes);

    chunks.push({
      index: chunkIndex,
      startFrame,
      endFrame,
      src: chunkFileName,
      byteLength: packedBytes.byteLength,
      framesCount: sliceFiles.length,
    });

    totalBytes += packedBytes.byteLength;
    chunkIndex++;
    fileIndex += sliceFiles.length;
  }

  return { chunks, totalBytes };
}

export function buildSinglePackRange(options: {
  frameFiles: string[];
  outputDir: string;
  packFileName?: string;
}): { frames: FrameRecord[]; totalBytes: number; packFileName: string } {
  const { frameFiles, outputDir, packFileName = 'all_frames.bin' } = options;
  fs.mkdirSync(outputDir, { recursive: true });

  const frameEntries = frameFiles.map((filePath, index) => {
    const fileData = fs.readFileSync(filePath);
    return {
      frameIndex: index,
      data: new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength),
    };
  });

  const packedBytes = packCEPK(frameEntries);
  const packFilePath = path.join(outputDir, packFileName);
  fs.writeFileSync(packFilePath, packedBytes);

  // In CEPK format:
  // Header: 16 bytes
  // Index Table: count * 16 bytes
  // Payload: payloadStartOffset = 16 + count * 16
  const count = frameEntries.length;
  const payloadStartOffset = 16 + count * 16;

  let currentRelOffset = 0;
  const frames: FrameRecord[] = [];

  for (let i = 0; i < count; i++) {
    const length = frameEntries[i].data.byteLength;
    const absOffset = payloadStartOffset + currentRelOffset;

    frames.push({
      id: i,
      byteOffset: absOffset,
      byteLength: length,
    });

    currentRelOffset += length;
  }

  return { frames, totalBytes: packedBytes.byteLength, packFileName };
}

export function buildIndividualFrameRecords(frameFiles: string[]): FrameRecord[] {
  return frameFiles.map((filePath, index) => {
    const stat = fs.statSync(filePath);
    return {
      id: index,
      src: path.basename(filePath),
      byteLength: stat.size,
    };
  });
}
