export interface CachedFrame<T = ImageBitmap | HTMLCanvasElement | HTMLImageElement> {
  id: number;
  data: T;
  width: number;
  height: number;
  byteSize: number;
  lastAccessTime: number;
}

export interface CacheOptions {
  /** Maximum memory in bytes for decoded bitmaps. Default: auto-detected (70MB mobile, 350MB desktop) */
  maxMemoryBytes?: number;
  /** Eviction penalty multiplier for frames behind scroll direction. Default: 2.0 */
  directionalPenalty?: number;
  /** Byte budget for compressed-blob LRU cache in MB. Default: ~128MB desktop, ~48MB mobile */
  blobBudgetMb?: number;
}

export interface CacheStats {
  totalBytes: number;
  maxBytes: number;
  frameCount: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

export interface BlobCacheOptions {
  blobBudgetMb?: number;
  maxBytes?: number;
}

export interface BlobCacheStats {
  totalBytes: number;
  maxBytes: number;
  count: number;
  hitCount: number;
  missCount: number;
}
