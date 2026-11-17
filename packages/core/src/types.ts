import { AnimationManifest, ResolutionVariant } from '@zoetrope/manifest';
import { FitMode } from '@zoetrope/renderer';

export class ZoetropeError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ZoetropeError';
  }
}

export class ManifestError extends ZoetropeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ERR_MANIFEST', cause);
    this.name = 'ManifestError';
  }
}

export class DecodeError extends ZoetropeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ERR_DECODE', cause);
    this.name = 'DecodeError';
  }
}

export class StreamError extends ZoetropeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ERR_STREAM', cause);
    this.name = 'StreamError';
  }
}

export class RendererError extends ZoetropeError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ERR_RENDERER', cause);
    this.name = 'RendererError';
  }
}

export type PlaybackMode = 'scroll' | 'scrub' | 'loop' | 'manual';

export interface ZoetropeOptions {
  canvas: HTMLCanvasElement;
  manifest: string | AnimationManifest;
  baseUrl?: string;
  debug?: boolean;
  respectReducedMotion?: boolean;
  debounceResizeMs?: number;

  playback?: {
    mode?: PlaybackMode;
    container?: Window | HTMLElement;
    triggerElement?: HTMLElement;
    smoothing?: {
      enabled?: boolean;
      tau?: number;
      epsilon?: number;
    };
    fpsLimit?: number;
  };

  renderer?: {
    fit?: FitMode;
    maxDpr?: number;
    clearOnStall?: boolean;
  };

  cache?: {
    maxMemoryBytes?: number;
    directionalPenalty?: number;
    blobBudgetMb?: number;
  };

  streaming?: {
    lookahead?: number;
    lookbehind?: number;
    concurrency?: number;
    velocityAware?: boolean;
    flingPrediction?: boolean;
  };

  decoder?: {
    concurrency?: number;
    preferWorker?: boolean;
    resizeToCanvas?: boolean;
    premultiplyAlpha?: 'none' | 'premultiply' | 'default';
    colorSpaceConversion?: 'none' | 'default';
    eagerPrefetchDecode?: boolean;
  };

  adaptive?: {
    enabled?: boolean;
    startupDowngrade?: boolean;
    latencyThresholdMs?: number;
    recoveryThresholdMs?: number;
    windowSize?: number;
  };

  anchors?: {
    enabled?: boolean;
  };
}

export interface EngineStatsSummary {
  hitRatePct: number;
  missedFramesCount: number;
  totalDrawCalls: number;
  availabilityLatencyMs: { p50: number; p95: number; p99: number };
  displayedFrameError: { mean: number; p95: number; max: number };
  decodeTimeMs: { p50: number; p95: number };
  fetchTimeMs: { p50: number; p95: number };
  renderTimeMs: { p50: number; p95: number; p99: number };
  cacheBytes: number;
  maxCacheBytes: number;
  cachedFramesCount: number;
  anchorsLoadedCount: number;
  lookaheadScheduled: number;
  queueDepth: number;
  inFlightFetches: number;
  inFlightDecodes: number;
  cancelledRequestsCount: number;
  variantId: string;
  variantSwapCount: number;
  renderedSource: 'full' | 'anchor';
  currentDpr: number;
  requestsTotal: number;
  requestsPerFrame: Map<number, number>;
  blobCacheBytes: number;
  blobCacheMaxBytes: number;
}

export interface EngineTelemetry {
  fps: number;
  currentFrame: number;
  targetFrame: number;
  totalFrames: number;
  progress: number;
  targetProgress: number;
  velocity: number;
  direction: 1 | -1 | 0;
  memoryUsageMb: number;
  maxMemoryMb: number;
  cacheSizeBytes: number;
  cachedFramesCount: number;
  cacheHitRate: number;
  inFlightRequests: number;
  inFlightDecodes: number;
  queueDepth: number;
  lookaheadScheduled: number;
  cancelledRequestsCount: number;
  renderTimeMs: number;
  decodeTimeMs: number;
  fetchTimeMs: number;
  missedFrame: boolean;
  usedAnchorFallback: boolean;
  displayedFrameError: number;
  variantId: string;
  variantSwapCount: number;
  renderedSource: 'full' | 'anchor';
  requestsTotal: number;
  blobMemoryMb: number;
}

export type EngineEventMap = {
  frame: (data: { frameId: number; progress: number; telemetry: EngineTelemetry }) => void;
  telemetry: (stats: EngineStatsSummary) => void;
  load: (manifest: AnimationManifest) => void;
  error: (err: Error) => void;
  stall: (frameId: number) => void;
  resize: (variant: ResolutionVariant) => void;
};
