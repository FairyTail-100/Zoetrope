export type ImageMimeType = 'image/webp' | 'image/avif' | 'image/jpeg' | 'image/png';

export type PackingMode = 'individual' | 'chunked' | 'range';

export interface FrameRecord {
  id: number;
  src?: string;
  byteOffset?: number;
  byteLength?: number;
  checksum?: string;
  checksumType?: 'sha256' | 'crc32';
}

export interface ChunkRecord {
  index: number;
  startFrame: number;
  endFrame: number;
  src: string;
  byteLength?: number;
  framesCount: number;
  checksum?: string;
  checksumType?: 'sha256' | 'crc32';
}

export interface AnchorFrameRecord {
  frameId: number;
  src: string;
  byteLength?: number;
}

export interface AnchorSet {
  step: number;
  width: number;
  height: number;
  format: ImageMimeType;
  frames: AnchorFrameRecord[];
}

export interface VariantStats {
  totalBytes: number;
  minFrameBytes: number;
  medianFrameBytes: number;
  maxFrameBytes: number;
  decodedRgbaBytesPerFrame: number; // width * height * 4
  estimatedDecodedMemoryBytes: number; // width * height * 4 * framesCount
}

export interface VariantFormatSource {
  format: ImageMimeType;
  frameTemplate?: string;
  frameStartIndex?: number;
  framesCount?: number;
  frames?: FrameRecord[];
  chunks?: ChunkRecord[];
  singlePackUrl?: string;
  stats?: VariantStats;
}

export interface ResolutionVariant {
  id: string;
  minWidth: number;
  maxWidth?: number;
  width: number;
  height: number;
  format: ImageMimeType | ImageMimeType[];
  formats?: ImageMimeType[];
  sources?: VariantFormatSource[];
  packing: PackingMode;
  chunkSize?: number;
  step?: number;
  chunks?: ChunkRecord[];
  frames?: FrameRecord[];
  /** Compact URL template for individual frame mode, e.g. "frames/frame_%04d.webp" */
  frameTemplate?: string;
  frameStartIndex?: number;
  framesCount?: number;
  singlePackUrl?: string;
  stats?: VariantStats;
  anchors?: AnchorSet;
}

export interface MotionConfig {
  defaultEasing?: string;
  lut?: number[];
}

export interface AnimationMetadata {
  totalFrames: number;
  fps: number;
  duration: number;
  aspectRatio: string;
  contentHash?: string;
}

export interface AnimationManifest {
  $schema?: string;
  version: '1.0.0';
  id: string;
  metadata: AnimationMetadata;
  variants: ResolutionVariant[];
  motion?: MotionConfig;
}

/**
 * CEPK Binary Packet Header structure:
 * Byte 0-3: Magic ASCII bytes 'CEPK' (0x43, 0x45, 0x50, 0x4B)
 * Byte 4-5: Version uint16 (e.g. 1)
 * Byte 6-7: Flags uint16 (0 = default)
 * Byte 8-11: Count uint32 (N records)
 * Byte 12-15: Header CRC32 uint32 (checksum over bytes 0..11)
 * Byte 16 to 16 + N*16 - 1: Table of records (16 bytes each)
 *   Record:
 *     uint32 frameIndex
 *     uint32 offset (relative to payload start)
 *     uint32 byteLength
 *     uint32 crc32 (CRC32 checksum of this frame's payload bytes)
 * Byte 16 + N*16 to EOF: Raw image payloads
 */
export const CEPK_MAGIC = 0x4B504543; // Little-Endian 32-bit integer for 'C' 'E' 'P' 'K' (0x43, 0x45, 0x50, 0x4B)
export const CEPK_VERSION = 1;
export const CEPK_HEADER_SIZE = 16;
export const CEPK_RECORD_SIZE = 16;

export interface CEPKRecord {
  frameIndex: number;
  offset: number;
  byteLength: number;
  crc32: number;
}
