import { BlobCacheStats } from '@zoetropejs/cache';

export interface FrameFetchRequest {
  frameId: number;
  priority: number;
  abortController: AbortController;
  resolve: (buffer: ArrayBuffer) => void;
  reject: (err: Error) => void;
}

export interface StreamingOptions {
  /** Maximum concurrent HTTP requests. Default: 4 */
  concurrency?: number;
  /** Lookahead window size (frames ahead of playhead). Default: 18 */
  lookahead?: number;
  /** Lookbehind window size (frames behind playhead). Default: 6 */
  lookbehind?: number;
  /** Retry count on failure. Default: 2 */
  maxRetries?: number;
  /** Whether to scale lookahead dynamically with scrub velocity. Default: true */
  velocityAware?: boolean;
  /** Whether to predict landing frame on high-velocity flings and skip intermediates. Default: true */
  flingPrediction?: boolean;
  /** Compressed-blob cache budget in MB. Default: ~128MB desktop, ~48MB mobile */
  blobBudgetMb?: number;
  /** External callback to check if a frame is already decoded and resident in engine cache */
  isFrameResident?: (frameId: number) => boolean;
  /** Maximum frames the decoded cache can hold, used to clamp prefetch window */
  maxBudgetFrames?: number;
}

export interface StreamerStats {
  requestsTotal: number;
  requestsPerFrame: Map<number, number>;
  inFlightCount: number;
  queueDepth: number;
  activeFetchCount: number;
  cancelledRequestsCount: number;
  blobCache: BlobCacheStats;
}
