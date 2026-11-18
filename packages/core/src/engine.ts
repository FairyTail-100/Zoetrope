import {
  AnimationManifest,
  ResolutionVariant,
  validateManifest,
  selectVariantWithHysteresis,
} from '@zoetropejs/manifest';
import { DirectionalLRUCache, CacheStats } from '@zoetropejs/cache';
import {
  ExponentialSmoother,
  VelocityTracker,
  MotionLUT,
  ScrollDriver,
} from '@zoetropejs/motion';
import {
  FrameDecoder,
  createDecoder,
  DecodedFrameTarget,
  negotiateVariantFormat,
  DecodeRequestOptions,
} from '@zoetropejs/decoder';
import { ChunkStreamer } from '@zoetropejs/streaming';
import { CanvasRenderer } from '@zoetropejs/renderer';
import {
  ZoetropeOptions,
  EngineTelemetry,
  EngineStatsSummary,
  EngineEventMap,
  PlaybackMode,
  RendererError,
  ManifestError,
  StreamError,
} from './types.js';

function calcPercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 100) / 100;
}

export class Zoetrope {
  private options: ZoetropeOptions;
  private manifest!: AnimationManifest;
  private currentVariant!: ResolutionVariant;
  private baseUrl: string = '';

  private cache!: DirectionalLRUCache<DecodedFrameTarget>;
  private anchorCache: Map<number, DecodedFrameTarget> = new Map();
  private decoder!: FrameDecoder;
  private streamer!: ChunkStreamer;
  private renderer!: CanvasRenderer;

  private smoother!: ExponentialSmoother;
  private velocityTracker!: VelocityTracker;
  private motionLUT!: MotionLUT;
  private scrollDriver?: ScrollDriver;

  private playbackMode: PlaybackMode;
  private isRunning: boolean = false;
  private isDestroyed: boolean = false;
  private rafId: number | null = null;

  private targetProgress: number = 0;
  private smoothedProgress: number = 0;
  private currentFrameId: number = 0;
  private lastTimestamp: number = 0;

  // Decode concurrency semaphore (F4)
  private decodeConcurrency: number = 4;
  private activeDecodesCount: number = 0;
  private inFlightDecodeIds: Set<number> = new Set();
  private decodeQueue: Array<{
    frameId: number;
    isImmediate: boolean;
    run: () => Promise<void>;
    cancel: () => void;
  }> = [];

  // Telemetry & stats collectors (P3.5)
  private fps: number = 60;
  private frameCountInInterval: number = 0;
  private lastFpsUpdateTime: number = 0;

  private lastDecodeTimeMs: number = 0;
  private lastFetchTimeMs: number = 0;
  private lastMissedFrame: boolean = false;
  private lastUsedAnchorFallback: boolean = false;
  private lastDisplayedFrameError: number = 0;

  private totalDrawCalls: number = 0;
  private missedFramesCount: number = 0;
  private renderTimesHistory: number[] = [];
  private decodeTimesHistory: number[] = [];
  private fetchTimesHistory: number[] = [];
  private displayedErrorsHistory: number[] = [];
  private frameRequestTimestamps: Map<number, number> = new Map();
  private frameAvailabilityLatencies: number[] = [];

  // Adaptive resolution & variant stability state
  private isDowngradedDpr: boolean = false;
  private initialMaxDpr: number = 2.0;
  private variantSwapCount: number = 0;
  private lastRenderedSource: 'full' | 'anchor' = 'full';
  private pendingResizeCheck: boolean = false;

  private eventListeners: { [K in keyof EngineEventMap]?: Array<EngineEventMap[K]> } = {};

  constructor(options: ZoetropeOptions) {
    this.options = options;
    this.playbackMode = options.playback?.mode ?? 'scroll';
    this.initialMaxDpr = options.renderer?.maxDpr ?? 2.0;
    const hwCores =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 4;
    this.decodeConcurrency = Math.max(
      1,
      options.decoder?.concurrency ?? Math.min(4, Math.max(1, hwCores - 1))
    );
    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  public async init(): Promise<void> {
    if (!this.options.canvas) {
      const err = new RendererError("Target canvas not found. Ensure options.canvas is a valid HTMLCanvasElement (e.g. document.querySelector('canvas')).");
      this.emit('error', err);
      throw err;
    }

    // 1. Resolve & validate manifest
    if (typeof this.options.manifest === 'string') {
      const manifestUrl = this.options.manifest;
      this.baseUrl =
        this.options.baseUrl ??
        manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);

      let res: Response;
      try {
        res = await fetch(manifestUrl);
      } catch (fetchErr: any) {
        const err = new StreamError(`Failed to fetch manifest from "${manifestUrl}". This typically indicates a CORS configuration error (ensure the server sends 'Access-Control-Allow-Origin: *') or network disconnect: ${fetchErr?.message || fetchErr}`, fetchErr);
        this.emit('error', err);
        throw err;
      }

      if (res.status === 404) {
        const err = new ManifestError(`Manifest file not found (404) at "${manifestUrl}". Verify file path and web server routing.`);
        this.emit('error', err);
        throw err;
      }
      if (!res.ok) {
        const err = new ManifestError(`Failed to load manifest: HTTP ${res.status} (${res.statusText}) from "${manifestUrl}"`);
        this.emit('error', err);
        throw err;
      }

      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        const err = new ManifestError(`Server returned unexpected MIME type "${contentType}" for manifest at "${manifestUrl}". Expected application/json (check SPA rewrite rules).`);
        this.emit('error', err);
        throw err;
      }

      let json: any;
      try {
        json = await res.json();
      } catch (parseErr) {
        const err = new ManifestError(`Invalid JSON format in manifest at "${manifestUrl}": ${parseErr}`);
        this.emit('error', err);
        throw err;
      }
      try {
        this.manifest = validateManifest(json);
      } catch (valErr: any) {
        const err = new ManifestError(`Failed to validate manifest from "${manifestUrl}": ${valErr?.message || valErr}`, valErr);
        this.emit('error', err);
        throw err;
      }
    } else if (typeof this.options.manifest === 'object' && this.options.manifest !== null) {
      try {
        this.manifest = validateManifest(this.options.manifest);
      } catch (valErr: any) {
        const err = new ManifestError(`Invalid manifest object: ${valErr?.message || valErr}`, valErr);
        this.emit('error', err);
        throw err;
      }
      this.baseUrl = this.options.baseUrl ?? '';
    } else {
      const receivedType = this.options.manifest === null ? 'null' : typeof this.options.manifest;
      const err = new ManifestError(`options.manifest must be a URL string or a valid AnimationManifest object, received: ${receivedType}`);
      this.emit('error', err);
      throw err;
    }

    // 2. Setup Motion & LUT
    this.smoother = new ExponentialSmoother(0, {
      enabled: this.options.playback?.smoothing?.enabled ?? true,
      tau: this.options.playback?.smoothing?.tau ?? 28,
      epsilon: this.options.playback?.smoothing?.epsilon ?? 0.0001,
    });
    this.velocityTracker = new VelocityTracker(0);
    this.motionLUT = new MotionLUT(this.manifest.motion?.lut);

    // 3. Setup Cache & Decoder
    this.cache = new DirectionalLRUCache<DecodedFrameTarget>({
      maxMemoryBytes: this.options.cache?.maxMemoryBytes,
      directionalPenalty: this.options.cache?.directionalPenalty ?? 2.0,
    });
    this.decoder = createDecoder({
      preferWorker: this.options.decoder?.preferWorker ?? false,
      workerCount: this.decodeConcurrency,
      defaultDecodeOptions: {
        premultiplyAlpha: this.options.decoder?.premultiplyAlpha ?? 'default',
        colorSpaceConversion: this.options.decoder?.colorSpaceConversion ?? 'default',
      },
    });

    // 4. Setup Variant & Renderer (after decoder is ready for format negotiation)
    this.renderer = new CanvasRenderer({
      canvas: this.options.canvas,
      fit: this.options.renderer?.fit ?? 'cover',
      maxDpr: this.initialMaxDpr,
      clearOnStall: this.options.renderer?.clearOnStall ?? false,
    });

    await this.selectAndApplyVariant(true);

    // 5. Setup Scroll Driver if in scroll mode
    let reducedMotionActive = false;
    if (
      this.options.respectReducedMotion !== false &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      try {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (query.matches) {
          reducedMotionActive = true;
        }
      } catch { /* matchMedia unavailable; keep reducedMotionActive false */ }
    }

    if (this.playbackMode === 'scroll' && !reducedMotionActive) {
      this.scrollDriver = new ScrollDriver({
        container: this.options.playback?.container,
        triggerElement: this.options.playback?.triggerElement,
      });
      this.scrollDriver.init((progress) => {
        this.targetProgress = progress;
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize, { passive: true });
      window.addEventListener('pageshow', this.handlePageShow as EventListener);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }
    }
    if (this.options.canvas) {
      this.options.canvas.addEventListener('contextlost', this.handleContextLost);
      this.options.canvas.addEventListener('contextrestored', this.handleContextRestored);
    }
    this.setupDebugHud();

    // First-Frame Priority Gate:
    // Frame 0 must be fetched, decoded, and rendered to canvas BEFORE anchors and lookahead start.
    if (this.playbackMode === 'scroll' || this.playbackMode === 'manual') {
      try {
        await this.renderFrame(0);
      } catch {
        // Handled inside renderFrame
      }
    }

    // P3.1: Load Low-Res Anchor Set right after Frame 0 in background before general lookahead starts
    if (this.options.anchors?.enabled !== false && this.currentVariant.anchors) {
      void this.loadAnchors();
    }

    // Emit load event
    this.emit('load', this.manifest);

    // Initial prefetch & paint loop if in scroll mode
    if (this.playbackMode === 'scroll') {
      this.start();
    }
  }

  private async loadAnchors(): Promise<void> {
    const anchorSet = this.currentVariant.anchors;
    if (!anchorSet || !anchorSet.frames || anchorSet.frames.length === 0) return;

    const base = this.baseUrl.endsWith('/') || this.baseUrl === '' ? this.baseUrl : this.baseUrl + '/';
    const mime = anchorSet.format || 'image/webp';

    await Promise.all(
      anchorSet.frames.map(async (af) => {
        if (this.isDestroyed) return;
        try {
          const res = await fetch(base + af.src, { priority: 'high' } as RequestInit);
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          const bmp = await this.decoder.decode(buf, mime);
          if (!this.isDestroyed) {
            this.anchorCache.set(af.frameId, bmp);
          } else if ('close' in bmp && typeof (bmp as ImageBitmap).close === 'function') {
            (bmp as ImageBitmap).close();
          }
        } catch {
          // Ignore individual anchor failure
        }
      })
    );
  }

  private scheduleDecode(
    frameId: number,
    buffer: ArrayBuffer,
    mimeType: string,
    isImmediate: boolean
  ): Promise<DecodedFrameTarget> {
    const estimatedFrameBytes = this.getEstimatedDecodedFrameBytes();
    this.cache.reserveInFlight(estimatedFrameBytes);
    this.inFlightDecodeIds.add(frameId);

    return new Promise<DecodedFrameTarget>((resolve, reject) => {
      const task = {
        frameId,
        isImmediate,
        cancel: () => {
          this.cache.releaseInFlight(estimatedFrameBytes);
          this.inFlightDecodeIds.delete(frameId);
          reject(new DOMException(`Decode for frame ${frameId} cancelled`, 'AbortError'));
        },
        run: async () => {
          this.activeDecodesCount++;
          const tDec0 = performance.now();
          try {
            const decodeOpts = this.getDecodeRequestOptions();
            const bmp = await this.decoder.decode(buffer, mimeType, decodeOpts);
            this.lastDecodeTimeMs = performance.now() - tDec0;
            this.decodeTimesHistory.push(this.lastDecodeTimeMs);
            resolve(bmp);
          } catch (err) {
            reject(err);
          } finally {
            this.cache.releaseInFlight(estimatedFrameBytes);
            this.inFlightDecodeIds.delete(frameId);
            this.activeDecodesCount--;
            this.pumpDecodeQueue();
          }
        },
      };

      if (this.activeDecodesCount < this.decodeConcurrency) {
        void task.run();
      } else {
        if (isImmediate) {
          this.decodeQueue.unshift(task);
        } else {
          this.decodeQueue.push(task);
        }
      }
    });
  }

  private purgeStaleDecodeQueue(cursor: number, direction: number, lookahead: number): void {
    const remaining: typeof this.decodeQueue = [];
    for (const item of this.decodeQueue) {
      if (item.isImmediate) {
        remaining.push(item);
        continue;
      }
      const diff = (item.frameId - cursor) * direction;
      const isStale = diff > lookahead * 1.5 || (diff < 0 && Math.abs(diff) > 8);
      if (isStale) {
        item.cancel();
      } else {
        remaining.push(item);
      }
    }
    this.decodeQueue = remaining;
  }

  private pumpDecodeQueue(): void {
    while (this.activeDecodesCount < this.decodeConcurrency && this.decodeQueue.length > 0) {
      const next = this.decodeQueue.shift()!;
      void next.run();
    }
  }

  private getDecodeRequestOptions(): DecodeRequestOptions | undefined {
    if (!this.options.decoder?.resizeToCanvas) return undefined;
    const metrics = this.renderer.getMetrics();
    if (
      metrics.canvasWidth > 0 &&
      metrics.canvasHeight > 0 &&
      metrics.canvasWidth < this.currentVariant.width &&
      metrics.canvasHeight < this.currentVariant.height
    ) {
      return {
        resizeWidth: metrics.canvasWidth,
        resizeHeight: metrics.canvasHeight,
        resizeQuality: 'medium',
      };
    }
    return undefined;
  }

  private getEstimatedDecodedFrameBytes(): number {
    const opts = this.getDecodeRequestOptions();
    if (opts?.resizeWidth && opts?.resizeHeight) {
      return opts.resizeWidth * opts.resizeHeight * 4;
    }
    return this.currentVariant.width * this.currentVariant.height * 4;
  }

  public start(): void {
    if (this.isRunning || this.isDestroyed) return;
    this.isRunning = true;
    this.lastTimestamp = performance.now();
    this.lastFpsUpdateTime = this.lastTimestamp;
    this.rafId = requestAnimationFrame(this.tick);
  }

  public pause(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public seek(progress: number, immediate = false): void {
    this.targetProgress = Math.max(0, Math.min(1, progress));
    if (immediate) {
      this.smoother.reset(this.targetProgress);
      this.smoothedProgress = this.targetProgress;
    }
    if (this.playbackMode === 'manual') {
      const mappedProgress = this.motionLUT.evaluate(this.smoothedProgress);
      const totalFrames = this.manifest.metadata.totalFrames;
      const targetFrameId = Math.round(mappedProgress * (totalFrames - 1));
      void this.renderFrame(targetFrameId);
    }
  }

  private tick(now: number): void {
    if (!this.isRunning || this.isDestroyed) return;

    const dt = Math.min(100, Math.max(1, now - this.lastTimestamp));
    this.lastTimestamp = now;

    // Calculate FPS
    this.frameCountInInterval++;
    if (now - this.lastFpsUpdateTime >= 500) {
      this.fps = Math.round((this.frameCountInInterval * 1000) / (now - this.lastFpsUpdateTime));
      this.frameCountInInterval = 0;
      this.lastFpsUpdateTime = now;
    }

    // Update smoother
    this.smoothedProgress = this.smoother.update(this.targetProgress, dt);

    // Map progress through LUT
    const mappedProgress = this.motionLUT.evaluate(this.smoothedProgress);

    // Map to frame ID
    const totalFrames = this.manifest.metadata.totalFrames;
    const targetFrameId = Math.min(
      totalFrames - 1,
      Math.max(0, Math.round(mappedProgress * (totalFrames - 1)))
    );

    // Track velocity & direction
    const { velocity, direction } = this.velocityTracker.update(mappedProgress, now);
    const velocityFps = Math.abs(velocity) * (totalFrames - 1);

    // Inform cache and streamer with velocity-aware scaling
    const effDir = direction !== 0 ? direction : 1;
    this.cache.updateCursor(targetFrameId, effDir);
    this.streamer.updateHorizon(targetFrameId, effDir, velocityFps);
    this.purgeStaleDecodeQueue(targetFrameId, effDir, this.streamer.getEffectiveLookahead());

    // Render frame
    void this.renderFrame(targetFrameId);

    // If a resize happened during scroll, check if velocity is now idle to perform deferred variant swap
    if (this.pendingResizeCheck) {
      const isScrolling =
        Math.abs(velocity) > 0.0001 ||
        Math.abs(this.targetProgress - this.smoothedProgress) > 0.001;
      if (!isScrolling) {
        this.pendingResizeCheck = false;
        void this.selectAndApplyVariant(false);
      }
    }

    // Schedule next frame
    this.rafId = requestAnimationFrame(this.tick);
  }

  private async renderFrame(frameId: number): Promise<void> {
    this.currentFrameId = frameId;
    this.totalDrawCalls++;

    // Check if frame in cache
    const cached = this.cache.get(frameId);
    if (cached) {
      this.lastMissedFrame = false;
      this.lastUsedAnchorFallback = false;
      this.lastDisplayedFrameError = 0;
      this.displayedErrorsHistory.push(0);
      this.lastRenderedSource = 'full';
      this.renderer.render(cached, frameId);
      this.renderTimesHistory.push(this.renderer.getMetrics().drawTimeMs);
      this.cache.setActiveDisplayedFrameId(frameId);
      this.emitTelemetry(frameId, frameId);
      return;
    }

    // Frame miss: target frame not resident at draw time
    this.lastMissedFrame = true;
    this.missedFramesCount++;
    if (!this.frameRequestTimestamps.has(frameId)) {
      this.frameRequestTimestamps.set(frameId, performance.now());
    }

    // P3.1: Compare nearest full-res cached frame vs nearest low-res anchor frame; draw whichever is closer
    const fallback = this.getNearestFallbackFrame(frameId);
    const displayedId = fallback ? fallback.id : frameId;
    this.lastUsedAnchorFallback = Boolean(fallback?.isAnchor);
    this.lastDisplayedFrameError = Math.abs(displayedId - frameId);
    this.displayedErrorsHistory.push(this.lastDisplayedFrameError);

    if (fallback) {
      this.lastRenderedSource = fallback.isAnchor ? 'anchor' : 'full';
      this.renderer.render(fallback.data, fallback.id);
      this.renderTimesHistory.push(this.renderer.getMetrics().drawTimeMs);
      if (!fallback.isAnchor) {
        this.cache.setActiveDisplayedFrameId(fallback.id);
      }
    }
    this.emit('stall', frameId);
    this.emitTelemetry(displayedId, frameId);

    try {
      const tFetch0 = performance.now();
      const buffer = await this.streamer.fetchFrame(frameId);
      this.lastFetchTimeMs = performance.now() - tFetch0;
      this.fetchTimesHistory.push(this.lastFetchTimeMs);

      const variantFormat = Array.isArray(this.currentVariant.format)
        ? this.currentVariant.format[0]
        : this.currentVariant.format;
      const decoded = await this.scheduleDecode(frameId, buffer, variantFormat, true);

      // Record availability latency if frame was waited on
      if (this.frameRequestTimestamps.has(frameId)) {
        const reqTime = this.frameRequestTimestamps.get(frameId)!;
        const availLatency = performance.now() - reqTime;
        this.frameAvailabilityLatencies.push(availLatency);
        this.frameRequestTimestamps.delete(frameId);
        this.evaluateAdaptiveResolution(false);
      }

      // If cursor has moved far away while decoding, check retention policy
      const dist = Math.abs(this.currentFrameId - frameId);
      const lookahead = this.options.streaming?.lookahead ?? 18;

      if (dist > lookahead * 2) {
        // Discard result if cursor has moved far beyond window to prevent cache bloat
        if ('close' in decoded && typeof (decoded as ImageBitmap).close === 'function') {
          try {
            (decoded as ImageBitmap).close();
          } catch {
            // Ignored
          }
        }
      } else {
        this.cache.put(frameId, decoded);
      }

      // CRITICAL RULE: ONLY paint if this decoded frame is still the current active frame!
      // Never paint an old late frame over the new current frame.
      if (this.currentFrameId === frameId) {
        this.lastMissedFrame = false;
        this.lastUsedAnchorFallback = false;
        this.lastDisplayedFrameError = 0;
        this.lastRenderedSource = 'full';
        this.renderer.render(decoded, frameId);
        this.renderTimesHistory.push(this.renderer.getMetrics().drawTimeMs);
        this.cache.setActiveDisplayedFrameId(frameId);
        this.emitTelemetry(frameId, frameId);
      }
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      const isAbort = errorObj.name === 'AbortError' || errorObj.message.includes('aborted');
      if (!isAbort) {
        this.emit('error', errorObj);
        // Ensure nearest cached frame continues to display on failure
        const fallbackAfterError = this.getNearestFallbackFrame(frameId);
        if (fallbackAfterError) {
          this.lastRenderedSource = fallbackAfterError.isAnchor ? 'anchor' : 'full';
          this.renderer.render(fallbackAfterError.data, fallbackAfterError.id);
          if (!fallbackAfterError.isAnchor) {
            this.cache.setActiveDisplayedFrameId(fallbackAfterError.id);
          }
        }
      }
    }
  }

  private getNearestFallbackFrame(
    targetId: number
  ): { id: number; data: DecodedFrameTarget; isAnchor: boolean } | null {
    let bestId = -1;
    let bestData: DecodedFrameTarget | null = null;
    let bestDiff = Infinity;
    let bestIsAnchor = false;

    const cachedIds = this.cache.getCachedIds();
    for (let i = 0; i < cachedIds.length; i++) {
      const id = cachedIds[i];
      const diff = Math.abs(id - targetId);
      if (diff < bestDiff) {
        const data = this.cache.get(id);
        if (data) {
          bestDiff = diff;
          bestId = id;
          bestData = data;
          bestIsAnchor = false;
        }
      }
    }

    if (this.options.anchors?.enabled !== false && this.anchorCache.size > 0) {
      for (const [anchorId, anchorBmp] of this.anchorCache.entries()) {
        const diff = Math.abs(anchorId - targetId);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestId = anchorId;
          bestData = anchorBmp;
          bestIsAnchor = true;
        }
      }
    }

    return bestData ? { id: bestId, data: bestData, isAnchor: bestIsAnchor } : null;
  }

  private evaluateAdaptiveResolution(isStartup: boolean = false): void {
    if (!isStartup || (this.options.adaptive?.enabled !== true && this.options.adaptive?.startupDowngrade !== true)) return;

    if (
      typeof navigator !== 'undefined' &&
      typeof (navigator as any).deviceMemory === 'number' &&
      (navigator as any).deviceMemory <= 2
    ) {
      const sortedByArea = [...this.manifest.variants].sort(
        (a, b) => a.width * a.height - b.width * b.height
      );
      const lowest = sortedByArea[0];
      if (lowest && lowest.id !== this.currentVariant.id) {
        console.warn(
          `[Zoetrope] Startup downgrade: selected variant "${lowest.id}" due to low device memory (${(navigator as any).deviceMemory} GB)`
        );
        this.currentVariant = lowest;
      }
    }
  }

  public stats(): EngineStatsSummary {
    const cacheStats: CacheStats = this.cache.getStats();
    const renderMetrics = this.renderer.getMetrics();
    const meanError =
      this.displayedErrorsHistory.length > 0
        ? Math.round(
            (this.displayedErrorsHistory.reduce((a, b) => a + b, 0) /
              this.displayedErrorsHistory.length) *
              100
          ) / 100
        : 0;
    const maxError =
      this.displayedErrorsHistory.length > 0 ? Math.max(...this.displayedErrorsHistory) : 0;

    return {
      hitRatePct: Math.round(cacheStats.hitRate * 100),
      missedFramesCount: this.missedFramesCount,
      totalDrawCalls: this.totalDrawCalls,
      availabilityLatencyMs: {
        p50: calcPercentile(this.frameAvailabilityLatencies, 50),
        p95: calcPercentile(this.frameAvailabilityLatencies, 95),
        p99: calcPercentile(this.frameAvailabilityLatencies, 99),
      },
      displayedFrameError: {
        mean: meanError,
        p95: calcPercentile(this.displayedErrorsHistory, 95),
        max: maxError,
      },
      decodeTimeMs: {
        p50: calcPercentile(this.decodeTimesHistory, 50),
        p95: calcPercentile(this.decodeTimesHistory, 95),
      },
      fetchTimeMs: {
        p50: calcPercentile(this.fetchTimesHistory, 50),
        p95: calcPercentile(this.fetchTimesHistory, 95),
      },
      renderTimeMs: {
        p50: calcPercentile(this.renderTimesHistory, 50),
        p95: calcPercentile(this.renderTimesHistory, 95),
        p99: calcPercentile(this.renderTimesHistory, 99),
      },
      cacheBytes: cacheStats.totalBytes,
      maxCacheBytes: cacheStats.maxBytes,
      cachedFramesCount: cacheStats.frameCount,
      anchorsLoadedCount: this.anchorCache.size,
      lookaheadScheduled: this.streamer ? this.streamer.getLookaheadScheduled() : 0,
      queueDepth: this.streamer ? this.streamer.getQueueDepth() : 0,
      inFlightFetches: this.streamer ? this.streamer.getInFlightCount() : 0,
      inFlightDecodes: this.activeDecodesCount + this.decodeQueue.length,
      cancelledRequestsCount: this.streamer ? this.streamer.getCancelledRequestsCount() : 0,
      variantId: this.currentVariant?.id ?? 'default',
      variantSwapCount: this.variantSwapCount,
      renderedSource: this.lastRenderedSource,
      currentDpr: renderMetrics.dpr,
      requestsTotal: this.streamer ? this.streamer.getRequestsTotal() : 0,
      requestsPerFrame: this.streamer ? this.streamer.getRequestsPerFrame() : new Map(),
      blobCacheBytes: this.streamer ? this.streamer.getBlobCache().getStats().totalBytes : 0,
      blobCacheMaxBytes: this.streamer ? this.streamer.getBlobCache().getStats().maxBytes : 0,
    };
  }

  private emitTelemetry(displayedFrameId: number, targetFrameId: number = displayedFrameId): void {
    const stats: CacheStats = this.cache.getStats();
    const metrics = this.renderer.getMetrics();
    const streamerStats = this.streamer ? this.streamer.getStats() : null;

    const telemetry: EngineTelemetry = {
      fps: this.fps,
      currentFrame: displayedFrameId,
      targetFrame: targetFrameId,
      totalFrames: this.manifest.metadata.totalFrames,
      progress: this.smoothedProgress,
      targetProgress: this.targetProgress,
      velocity: this.velocityTracker.getVelocity(),
      direction: this.velocityTracker.getDirection(),
      memoryUsageMb: Math.round((stats.totalBytes / (1024 * 1024)) * 10) / 10,
      maxMemoryMb: Math.round((stats.maxBytes / (1024 * 1024)) * 10) / 10,
      cacheSizeBytes: stats.totalBytes,
      cachedFramesCount: stats.frameCount,
      cacheHitRate: Math.round(stats.hitRate * 100),
      inFlightRequests: this.streamer ? this.streamer.getInFlightCount() : 0,
      inFlightDecodes: this.activeDecodesCount + this.decodeQueue.length,
      queueDepth: this.streamer ? this.streamer.getQueueDepth() : 0,
      lookaheadScheduled: this.streamer ? this.streamer.getLookaheadScheduled() : 0,
      cancelledRequestsCount: this.streamer ? this.streamer.getCancelledRequestsCount() : 0,
      renderTimeMs: Math.round(metrics.drawTimeMs * 100) / 100,
      decodeTimeMs: Math.round(this.lastDecodeTimeMs * 100) / 100,
      fetchTimeMs: Math.round(this.lastFetchTimeMs * 100) / 100,
      missedFrame: this.lastMissedFrame,
      usedAnchorFallback: this.lastUsedAnchorFallback,
      displayedFrameError: this.lastDisplayedFrameError,
      variantId: this.currentVariant ? this.currentVariant.id : 'default',
      variantSwapCount: this.variantSwapCount,
      renderedSource: this.lastRenderedSource,
      requestsTotal: streamerStats ? streamerStats.requestsTotal : 0,
      blobMemoryMb: streamerStats ? Math.round((streamerStats.blobCache.totalBytes / (1024 * 1024)) * 10) / 10 : 0,
    };

    this.emit('frame', {
      frameId: displayedFrameId,
      progress: this.smoothedProgress,
      telemetry,
    });

    if (this.eventListeners.telemetry && this.eventListeners.telemetry.length > 0) {
      this.emit('telemetry', this.stats());
    }
  }

  private resizeDebounceTimer: any = null;
  private isTabHidden: boolean = false;

  private handleResize = (): void => {
    if (this.isDestroyed) return;
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }
    const debounceMs = this.options.debounceResizeMs ?? 250;
    this.resizeDebounceTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      this.renderer.resize();
      void this.selectAndApplyVariant(false);
    }, debounceMs);
  };

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.isTabHidden = true;
    } else {
      this.isTabHidden = false;
      if (this.playbackMode === 'scroll') this.start();
    }
  };

  private handlePageShow = (e: PageTransitionEvent): void => {
    if (e && e.persisted) {
      this.renderer.resize();
      if (this.playbackMode === 'scroll') this.start();
    }
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.emit('error', new RendererError('Canvas 2D context lost'));
  };

  private handleContextRestored = (): void => {
    this.renderer.resize();
    void this.renderFrame(this.currentFrameId);
  };

  private debugHudEl: HTMLElement | null = null;
  private setupDebugHud(): void {
    const isDebug =
      this.options.debug ||
      (typeof window !== 'undefined' &&
        window.location &&
        window.location.search &&
        window.location.search.includes('zoetrope-debug=1'));

    if (isDebug && typeof document !== 'undefined') {
      const hud = document.createElement('div');
      hud.id = 'zoetrope-debug-hud';
      hud.style.cssText =
        'position:fixed;bottom:12px;left:12px;background:rgba(0,0,0,0.85);color:#00ffcc;font-family:monospace;font-size:11px;padding:8px 12px;border-radius:4px;z-index:999999;pointer-events:none;line-height:1.4;border:1px solid #333;';
      const titleEl = document.createElement('strong');
      titleEl.textContent = 'ZOETROPE DEBUG HUD';
      const bodyEl = document.createElement('div');
      bodyEl.style.whiteSpace = 'pre-line';
      hud.appendChild(titleEl);
      hud.appendChild(bodyEl);
      document.body.appendChild(hud);
      this.debugHudEl = hud;

      this.on('frame', () => {
        if (this.debugHudEl) {
          const s = this.stats();
          bodyEl.textContent = [
            `Variant: ${s.variantId} (swaps: ${s.variantSwapCount}) | Source: ${s.renderedSource}`,
            `Frame: ${this.currentFrameId}/${this.manifest.metadata.totalFrames} | Hit: ${s.hitRatePct}%`,
            `Avail p95: ${s.availabilityLatencyMs.p95.toFixed(1)}ms | Blit: ${s.renderTimeMs.p95.toFixed(2)}ms`,
            `Dec: ${s.inFlightDecodes} | Q: ${s.queueDepth} | Mem: ${(s.cacheBytes / 1048576).toFixed(1)}MB | DPR: ${s.currentDpr}`,
          ].join('\n');
        }
      });
    }
  }

  private async selectAndApplyVariant(isStartup: boolean = false): Promise<void> {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

    if (isStartup) {
      if (
        (this.options.adaptive?.enabled === true || this.options.adaptive?.startupDowngrade === true) &&
        typeof navigator !== 'undefined' &&
        typeof (navigator as any).deviceMemory === 'number' &&
        (navigator as any).deviceMemory <= 2
      ) {
        const sortedByArea = [...this.manifest.variants].sort(
          (a, b) => a.width * a.height - b.width * b.height
        );
        const lowest = sortedByArea[0];
        console.warn(
          `[Zoetrope] Startup downgrade: selected variant "${lowest.id}" due to low device memory (${(navigator as any).deviceMemory} GB)`
        );
        await this.applyExplicitVariant(lowest);
        return;
      }

      const initialVariant = selectVariantWithHysteresis(
        this.manifest,
        screenWidth,
        undefined,
        dpr
      );
      await this.applyExplicitVariant(initialVariant);
      return;
    }

    const targetVariant = selectVariantWithHysteresis(
      this.manifest,
      screenWidth,
      this.currentVariant?.id,
      dpr
    );

    if (this.currentVariant?.id !== targetVariant.id) {
      const isScrolling =
        Math.abs(this.velocityTracker?.getVelocity() ?? 0) > 0.0001 ||
        Math.abs(this.targetProgress - this.smoothedProgress) > 0.001;

      if (isScrolling) {
        this.pendingResizeCheck = true;
        return;
      }

      await this.applyExplicitVariant(targetVariant);
      this.variantSwapCount++;
      this.emit('resize', this.currentVariant);
    }
  }

  private async applyExplicitVariant(rawVariant: ResolutionVariant): Promise<void> {
    const variant = await negotiateVariantFormat(rawVariant, this.decoder);
    this.currentVariant = variant;
    if (this.streamer) {
      this.streamer.destroy();
    }
    const singleFrameBytes = (variant.width || 1920) * (variant.height || 1080) * 4;
    const maxBudgetFrames = Math.max(4, Math.floor(this.cache.getStats().maxBytes / singleFrameBytes));

    this.streamer = new ChunkStreamer(variant, this.baseUrl, {
      ...this.options.streaming,
      blobBudgetMb: this.options.cache?.blobBudgetMb,
      maxBudgetFrames,
      isFrameResident: (frameId) => this.cache.has(frameId),
    });
    this.streamer.setOnPrefetch((frameId, buffer) => {
      if (this.options.decoder?.eagerPrefetchDecode === false) return;
      if (
        this.isDestroyed ||
        !this.cache ||
        this.cache.has(frameId) ||
        this.inFlightDecodeIds.has(frameId)
      ) {
        return;
      }

      const variantFormat = Array.isArray(this.currentVariant.format)
        ? this.currentVariant.format[0]
        : this.currentVariant.format;
      this.scheduleDecode(frameId, buffer, variantFormat, false)
        .then((bitmap) => {
          if (!this.cache.has(frameId) && !this.isDestroyed) {
            this.cache.put(frameId, bitmap);
          } else {
            if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') {
              try {
                (bitmap as ImageBitmap).close();
              } catch { /* bitmap already closed or detached */ }
            }
          }
        })
        .catch(() => {});
    });

    if (this.isRunning && !this.isDestroyed) {
      void this.renderFrame(this.currentFrameId);
    }
  }

  public getManifest(): AnimationManifest {
    return this.manifest;
  }

  public getSmoother(): ExponentialSmoother {
    return this.smoother;
  }

  public getRenderer(): CanvasRenderer {
    return this.renderer;
  }

  public getCache(): DirectionalLRUCache<DecodedFrameTarget> {
    return this.cache;
  }

  public getCurrentVariant(): ResolutionVariant {
    return this.currentVariant;
  }

  public getAvailabilityLatencies(): number[] {
    return this.frameAvailabilityLatencies;
  }

  public on<K extends keyof EngineEventMap>(event: K, listener: EngineEventMap[K]): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event]!.push(listener);
  }

  public off<K extends keyof EngineEventMap>(event: K, listener: EngineEventMap[K]): void {
    const list = this.eventListeners[event];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  private emit<K extends keyof EngineEventMap>(
    event: K,
    ...args: Parameters<EngineEventMap[K]>
  ): void {
    const list = this.eventListeners[event];
    if (list) {
      for (const listener of list) {
        // @ts-expect-error spread parameters
        listener(...args);
      }
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.pause();

    if (this.scrollDriver) {
      this.scrollDriver.destroy();
    }

    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
      window.removeEventListener('pageshow', this.handlePageShow as EventListener);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
    }

    if (this.options.canvas) {
      this.options.canvas.removeEventListener('contextlost', this.handleContextLost);
      this.options.canvas.removeEventListener('contextrestored', this.handleContextRestored);
    }

    if (this.debugHudEl && this.debugHudEl.parentNode) {
      this.debugHudEl.parentNode.removeChild(this.debugHudEl);
      this.debugHudEl = null;
    }

    if (this.cache) {
      this.cache.clear();
    }

    for (const bmp of this.anchorCache.values()) {
      if ('close' in bmp && typeof (bmp as ImageBitmap).close === 'function') {
        try {
          (bmp as ImageBitmap).close();
        } catch { /* bitmap already closed during destroy */ }
      }
    }
    this.anchorCache.clear();

    if (this.streamer) {
      this.streamer.destroy();
    }

    if (this.decoder) {
      this.decoder.dispose();
    }

    this.decodeQueue = [];
    this.eventListeners = {};
  }
}
