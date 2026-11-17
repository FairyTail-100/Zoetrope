import { ResolutionVariant, ChunkRecord } from '@zoetrope/manifest';
import { BlobCache } from '@zoetrope/cache';
import { PriorityQueue } from './priority-queue.js';
import { unpackCEPK } from './binary-pack.js';
import { StreamingOptions, FrameFetchRequest, StreamerStats } from './types.js';

export class ChunkStreamer {
  private variant: ResolutionVariant;
  private baseUrl: string;
  private options: Required<Omit<StreamingOptions, 'isFrameResident' | 'maxBudgetFrames' | 'blobBudgetMb'>> & {
    isFrameResident?: (frameId: number) => boolean;
    maxBudgetFrames?: number;
    blobBudgetMb?: number;
  };

  private queue: PriorityQueue = new PriorityQueue();
  private inFlightFetches: Map<number, Promise<ArrayBuffer>> = new Map();
  private inFlightChunks: Map<number, Promise<Map<number, Uint8Array>>> = new Map();
  private activeFetches: Map<number, FrameFetchRequest> = new Map();
  private activeRequestCount: number = 0;

  // Unpacked chunks buffer cache
  private chunkFrames: Map<number, Uint8Array> = new Map();
  // Two-tier compressed blob cache
  private blobCache: BlobCache;

  // Network request accounting
  private requestsTotal: number = 0;
  private requestsPerFrame: Map<number, number> = new Map();

  private currentCursor: number = 0;
  private currentDirection: 1 | -1 | 0 = 1;
  private currentVelocityFps: number = 0;
  private lastLookaheadScheduled: number = 0;
  private cancelledRequestsCount: number = 0;
  private onPrefetchCallback?: (frameId: number, buffer: ArrayBuffer) => void;

  constructor(variant: ResolutionVariant, baseUrl: string = '', options?: StreamingOptions) {
    this.variant = variant;
    this.baseUrl = baseUrl.endsWith('/') || baseUrl === '' ? baseUrl : baseUrl + '/';
    this.options = {
      concurrency: options?.concurrency ?? 4,
      lookahead: options?.lookahead ?? 18,
      lookbehind: options?.lookbehind ?? 6,
      maxRetries: options?.maxRetries ?? 2,
      velocityAware: options?.velocityAware ?? true,
      flingPrediction: options?.flingPrediction ?? true,
      isFrameResident: options?.isFrameResident,
      maxBudgetFrames: options?.maxBudgetFrames,
      blobBudgetMb: options?.blobBudgetMb,
    };
    this.blobCache = new BlobCache({ blobBudgetMb: options?.blobBudgetMb });
  }

  public setOnPrefetch(cb: (frameId: number, buffer: ArrayBuffer) => void): void {
    this.onPrefetchCallback = cb;
  }

  public setBudgetFrames(frames: number): void {
    this.options.maxBudgetFrames = frames;
  }

  public setIsFrameResident(cb: (frameId: number) => boolean): void {
    this.options.isFrameResident = cb;
  }

  public getBlobCache(): BlobCache {
    return this.blobCache;
  }

  public getEffectiveLookahead(): number {
    const base = this.options.lookahead;
    let lookahead = base;
    if (this.options.velocityAware) {
      // Scale lookahead with scrub velocity: at 30 fps -> 2.0x, at 60 fps -> 3.0x, capped at 60 frames
      const factor = Math.min(3.0, 1.0 + this.currentVelocityFps / 30);
      lookahead = Math.min(60, Math.round(base * factor));
    }
    if (this.options.maxBudgetFrames !== undefined && this.options.maxBudgetFrames > 0) {
      // Clamp lookahead so lookahead + lookbehind fits in decoded budget with safety margin
      const safeBudget = Math.max(2, Math.floor(this.options.maxBudgetFrames * 0.7) - this.options.lookbehind);
      lookahead = Math.min(lookahead, safeBudget);
    }
    return lookahead;
  }

  public getEffectiveLookbehind(): number {
    let lb = this.options.lookbehind;
    if (this.options.maxBudgetFrames !== undefined && this.options.maxBudgetFrames > 0) {
      const maxLb = Math.max(1, Math.floor(this.options.maxBudgetFrames * 0.2));
      lb = Math.min(lb, maxLb);
    }
    return lb;
  }

  public updateHorizon(cursor: number, direction: 1 | -1 | 0 = 1, velocityFps: number = 0): void {
    const isIdle = Math.abs(velocityFps) < 0.1 && cursor === this.currentCursor;
    this.currentCursor = cursor;
    this.currentDirection = direction !== 0 ? direction : 1;
    this.currentVelocityFps = Math.abs(velocityFps);

    // 1. Purge queued requests outside active window
    const purged = this.queue.purgeBeyond((frameId) => this.isOutOfHorizon(frameId));
    this.cancelledRequestsCount += purged;

    // 2. Abort in-flight network requests that have become stale due to direction change or jump
    for (const [frameId, activeReq] of this.activeFetches.entries()) {
      if (this.isOutOfHorizon(frameId)) {
        activeReq.abortController.abort();
        this.activeFetches.delete(frameId);
        this.cancelledRequestsCount++;
      }
    }

    // 3. Reprioritize remaining queue items
    this.queue.reprioritize((frameId) => this.calculatePriority(frameId));

    // 4. Schedule prefetch for upcoming frames (skip if idle and window already satisfied)
    if (!isIdle) {
      this.schedulePrefetches();
    }
  }

  public isResident(frameId: number): boolean {
    if (this.chunkFrames.has(frameId)) return true;
    if (this.blobCache.has(frameId)) return true;
    if (this.options.isFrameResident?.(frameId)) return true;
    return false;
  }

  public isFetchable(targetFrame: number): boolean {
    if (!this.isValidFrameId(targetFrame)) return false;
    if (this.chunkFrames.has(targetFrame)) return false;
    if (this.blobCache.has(targetFrame)) return false;
    if (this.blobCache.isRecentlyEvicted(targetFrame)) return false;
    if (this.inFlightFetches.has(targetFrame)) return false;
    if (this.options.isFrameResident?.(targetFrame)) return false;
    return true;
  }

  public async fetchFrame(frameId: number): Promise<ArrayBuffer> {
    // 1. If already available in an unpacked chunk
    if (this.chunkFrames.has(frameId)) {
      const fb = this.chunkFrames.get(frameId)!;
      return fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength) as ArrayBuffer;
    }

    // 2. If already in compressed blob cache, return directly (0 network requests!)
    if (this.blobCache.has(frameId)) {
      return this.blobCache.get(frameId)!;
    }

    // 3. If already in flight, reuse promise
    if (this.inFlightFetches.has(frameId)) {
      return this.inFlightFetches.get(frameId)!;
    }

    // 4. If variant is chunked, find the chunk containing this frame
    if (this.variant.packing === 'chunked' && this.variant.chunks) {
      const chunk = this.findChunkForFrame(frameId);
      if (chunk) {
        const fetchPromise = this.fetchAndUnpackChunk(chunk).then((framesMap) => {
          const frameBytes = framesMap.get(frameId);
          if (!frameBytes) {
            throw new Error(`Frame ${frameId} was not found inside chunk ${chunk.index}`);
          }
          return frameBytes.buffer.slice(
            frameBytes.byteOffset,
            frameBytes.byteOffset + frameBytes.byteLength
          ) as ArrayBuffer;
        });

        this.inFlightFetches.set(frameId, fetchPromise);
        return fetchPromise.finally(() => {
          this.inFlightFetches.delete(frameId);
        });
      }
    }

    // 5. Individual frame or range fetch with priority queue
    return this.queueFetch(frameId);
  }

  private queueFetch(frameId: number): Promise<ArrayBuffer> {
    const priority = this.calculatePriority(frameId);
    const abortController = new AbortController();

    const fetchPromise = new Promise<ArrayBuffer>((resolve, reject) => {
      this.queue.enqueue({
        frameId,
        priority,
        abortController,
        resolve,
        reject,
      });
      this.processQueue();
    });

    this.inFlightFetches.set(frameId, fetchPromise);
    return fetchPromise.finally(() => {
      this.inFlightFetches.delete(frameId);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeRequestCount >= this.options.concurrency) return;

    const req = this.queue.dequeue();
    if (!req) return;

    // If frame entered blob cache while waiting in queue, resolve immediately without network fetch
    if (this.blobCache.has(req.frameId)) {
      const buffer = this.blobCache.get(req.frameId)!;
      req.resolve(buffer);
      this.processQueue();
      return;
    }

    this.activeFetches.set(req.frameId, req);
    this.activeRequestCount++;

    try {
      let buffer: ArrayBuffer;
      const priorityHint: 'high' | 'low' = Math.abs(req.frameId - this.currentCursor) <= 2 ? 'high' : 'low';
      if (this.variant.packing === 'range') {
        buffer = await this.fetchRangeFrame(req.frameId, req.abortController.signal, priorityHint);
      } else {
        const frameUrl = this.resolveFrameUrl(req.frameId);
        buffer = await this.fetchWithRetry(frameUrl, req.abortController.signal, 0, priorityHint, req.frameId);
      }
      // Store into compressed blob cache upon successful fetch
      this.blobCache.put(req.frameId, buffer);
      req.resolve(buffer);
    } catch (err: unknown) {
      const isAbort =
        (err as Error)?.name === 'AbortError' ||
        req.abortController.signal.aborted ||
        (err as Error)?.message?.includes('aborted');

      if (isAbort) {
        req.reject(new DOMException(`Frame ${req.frameId} request aborted`, 'AbortError'));
      } else {
        req.reject(err as Error);
      }
    } finally {
      this.activeFetches.delete(req.frameId);
      this.activeRequestCount--;
      this.processQueue();
    }
  }

  private async fetchRangeFrame(
    frameId: number,
    signal?: AbortSignal,
    priorityHint: 'high' | 'low' = 'low'
  ): Promise<ArrayBuffer> {
    const frame = this.variant.frames?.find((f) => f.id === frameId);
    if (!frame || frame.byteOffset === undefined || frame.byteLength === undefined) {
      throw new Error(`Frame ${frameId} does not have range byteOffset/byteLength`);
    }
    const packUrl = this.baseUrl + (this.variant.singlePackUrl || 'pack.bin');
    const start = frame.byteOffset;
    const end = frame.byteOffset + frame.byteLength - 1;

    this.recordNetworkRequest(frameId);
    const res = await fetch(packUrl, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
      priority: priorityHint,
    } as RequestInit);

    if (res.status !== 206 && res.status !== 200) {
      throw new Error(`HTTP ${res.status} fetching range bytes=${start}-${end}`);
    }
    return await res.arrayBuffer();
  }

  private async fetchAndUnpackChunk(chunk: ChunkRecord): Promise<Map<number, Uint8Array>> {
    if (this.inFlightChunks.has(chunk.index)) {
      return this.inFlightChunks.get(chunk.index)!;
    }

    const chunkUrl = this.baseUrl + chunk.src;
    const chunkPromise = this.fetchWithRetry(chunkUrl).then((buf) => {
      // Off-hot-path verification: verify header CRC32 immediately, defer payload CRC32
      const unpacked = unpackCEPK(buf, 'header-only');
      for (const [id, bytes] of unpacked.frames.entries()) {
        this.chunkFrames.set(id, bytes);
        const frameBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        this.blobCache.put(id, frameBuf);
        this.onPrefetchCallback?.(id, frameBuf);
      }

      // Schedule background verification of payload checksums during idle time
      if (typeof requestIdleCallback === 'function' && unpacked.verifyPayloadChecksums) {
        requestIdleCallback(() => {
          try {
            unpacked.verifyPayloadChecksums?.();
          } catch (err) {
            console.error('CEPK payload checksum verification failed in background:', err);
          }
        });
      }

      return unpacked.frames;
    });

    this.inFlightChunks.set(chunk.index, chunkPromise);
    return chunkPromise.finally(() => {
      this.inFlightChunks.delete(chunk.index);
    });
  }

  private recordNetworkRequest(frameId?: number): void {
    this.requestsTotal++;
    if (frameId !== undefined) {
      this.requestsPerFrame.set(frameId, (this.requestsPerFrame.get(frameId) ?? 0) + 1);
    }
  }

  private async fetchWithRetry(
    url: string,
    signal?: AbortSignal,
    attempts = 0,
    priorityHint: 'high' | 'low' = 'low',
    frameId?: number
  ): Promise<ArrayBuffer> {
    try {
      this.recordNetworkRequest(frameId);
      let res: Response;
      try {
        res = await fetch(url, { signal, priority: priorityHint } as RequestInit);
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError' || signal?.aborted) {
          throw new DOMException(`Request to ${url} aborted`, 'AbortError');
        }
        throw new Error(
          `Network request failed for "${url}". Check CORS headers ('Access-Control-Allow-Origin: *') and connectivity: ${fetchErr?.message || fetchErr}`,
          { cause: fetchErr }
        );
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error(`Server returned unexpected MIME type "${contentType}" for frame asset at "${url}". Expected image/* (check SPA rewrite rules).`);
      }
      return await res.arrayBuffer();
    } catch (err) {
      const isAbort = (err as Error)?.name === 'AbortError' || signal?.aborted;
      if (isAbort) {
        throw new DOMException(`Request to ${url} aborted`, 'AbortError');
      }
      if (attempts < this.options.maxRetries) {
        // Exponential backoff with jitter/cap: 50ms, 100ms, 200ms... capped at 1000ms
        const delayMs = Math.min(1000, 50 * Math.pow(2, attempts));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.fetchWithRetry(url, signal, attempts + 1, priorityHint, frameId);
      }
      throw err;
    }
  }

  private getMaxValidFrameId(): number {
    if (this.variant.frames && this.variant.frames.length > 0) {
      return this.variant.frames[this.variant.frames.length - 1].id;
    }
    if (this.variant.frameTemplate) {
      return (this.variant.framesCount ?? 300) - 1;
    }
    if (this.variant.chunks && this.variant.chunks.length > 0) {
      return this.variant.chunks[this.variant.chunks.length - 1].endFrame;
    }
    return 0;
  }

  private schedulePrefetches(): void {
    const dir = this.currentDirection;
    const effectiveLookahead = this.getEffectiveLookahead();
    const lookbehindCount = this.getEffectiveLookbehind();
    let scheduled = 0;

    // P3.3: Landing-point prediction for high-velocity flings (> 120 fps):
    // Skip intermediate frames during a fling and fetch the predicted landing region first.
    if (this.options.flingPrediction && this.currentVelocityFps > 120) {
      const maxFrame = this.getMaxValidFrameId();
      const predictedDelta = Math.round(this.currentVelocityFps * 0.25) * dir;
      const landingCenter = Math.max(0, Math.min(maxFrame, this.currentCursor + predictedDelta));
      const landingRadius = Math.min(12, Math.round(effectiveLookahead / 2));

      for (let r = 0; r <= landingRadius; r++) {
        const candidates = r === 0 ? [landingCenter] : [landingCenter + r * dir, landingCenter - r * dir];
        for (const targetFrame of candidates) {
          if (this.isFetchable(targetFrame)) {
            scheduled++;
            this.fetchFrame(targetFrame)
              .then((buf) => {
                this.onPrefetchCallback?.(targetFrame, buf);
              })
              .catch(() => {});
          }
        }
      }
      this.lastLookaheadScheduled = scheduled;
      return;
    }

    // Standard velocity-aware prefetch forward in direction of travel
    for (let i = 1; i <= effectiveLookahead; i++) {
      const targetFrame = this.currentCursor + i * dir;
      if (this.isFetchable(targetFrame)) {
        scheduled++;
        this.fetchFrame(targetFrame)
          .then((buf) => {
            this.onPrefetchCallback?.(targetFrame, buf);
          })
          .catch(() => {
            // Prefetch cancellation or error swallowed to prevent unhandled rejection
          });
      }
    }

    // Retain or prefetch small lookbehind window
    for (let i = 1; i <= lookbehindCount; i++) {
      const targetFrame = this.currentCursor - i * dir;
      if (this.isFetchable(targetFrame)) {
        this.fetchFrame(targetFrame)
          .then((buf) => {
            this.onPrefetchCallback?.(targetFrame, buf);
          })
          .catch(() => {
            // Prefetch cancellation or error swallowed
          });
      }
    }
    this.lastLookaheadScheduled = effectiveLookahead;
  }

  private calculatePriority(frameId: number): number {
    const diff = (frameId - this.currentCursor) * this.currentDirection;
    const dist = Math.abs(frameId - this.currentCursor);

    if (dist === 0) return 10000; // Immediate frame

    if (diff > 0) {
      // In direction of travel: highest priority ahead
      return Math.max(1, 2000 - dist * 10);
    } else {
      // Behind direction of travel: lower priority
      return Math.max(1, 500 - dist * 20);
    }
  }

  private isOutOfHorizon(frameId: number): boolean {
    const diff = (frameId - this.currentCursor) * this.currentDirection;
    const effectiveLookahead = this.getEffectiveLookahead();
    if (diff > 0) {
      // Ahead in travel direction
      return diff > effectiveLookahead * 1.5;
    } else {
      // Behind in travel direction (stale on direction reversal)
      return Math.abs(diff) > this.getEffectiveLookbehind();
    }
  }

  private findChunkForFrame(frameId: number): ChunkRecord | undefined {
    return this.variant.chunks?.find(
      (c) => frameId >= c.startFrame && frameId <= c.endFrame
    );
  }

  private resolveFrameUrl(frameId: number): string {
    if (this.variant.frameTemplate) {
      const startNum = this.variant.frameStartIndex ?? 1;
      const num = frameId + startNum;
      const formatted = this.variant.frameTemplate
        .replace(/%0?(\d+)d/, (_, width) => String(num).padStart(parseInt(width, 10), '0'))
        .replace(/\{id\}/g, String(num));
      return this.baseUrl + formatted;
    }

    const frame = this.variant.frames?.find((f) => f.id === frameId);
    if (!frame) {
      throw new Error(`Frame ${frameId} not found in variant "${this.variant.id}" manifest`);
    }
    return this.baseUrl + (frame.src || '');
  }

  private isValidFrameId(frameId: number): boolean {
    if (this.variant.frames) {
      return this.variant.frames.some((f) => f.id === frameId);
    }
    if (this.variant.frameTemplate) {
      const count = this.variant.framesCount ?? 300;
      return frameId >= 0 && frameId < count;
    }
    if (this.variant.chunks) {
      const last = this.variant.chunks[this.variant.chunks.length - 1];
      const first = this.variant.chunks[0];
      return frameId >= first.startFrame && frameId <= last.endFrame;
    }
    return false;
  }

  public getInFlightCount(): number {
    return this.inFlightFetches.size + this.inFlightChunks.size;
  }

  public getQueueDepth(): number {
    return this.queue.size();
  }

  public getActiveFetchCount(): number {
    return this.activeRequestCount;
  }

  public getLookaheadScheduled(): number {
    return this.lastLookaheadScheduled || this.getEffectiveLookahead();
  }

  public getCancelledRequestsCount(): number {
    return this.cancelledRequestsCount;
  }

  public getRequestsTotal(): number {
    return this.requestsTotal;
  }

  public getRequestsPerFrame(): Map<number, number> {
    return this.requestsPerFrame;
  }

  public getStats(): StreamerStats {
    return {
      requestsTotal: this.requestsTotal,
      requestsPerFrame: this.requestsPerFrame,
      inFlightCount: this.getInFlightCount(),
      queueDepth: this.getQueueDepth(),
      activeFetchCount: this.activeRequestCount,
      cancelledRequestsCount: this.cancelledRequestsCount,
      blobCache: this.blobCache.getStats(),
    };
  }

  public clear(): void {
    this.queue.clear();
    for (const req of this.activeFetches.values()) {
      req.abortController.abort();
    }
    this.activeFetches.clear();
    this.inFlightFetches.clear();
    this.inFlightChunks.clear();
    this.chunkFrames.clear();
  }

  public destroy(): void {
    this.clear();
    this.blobCache.destroy();
    this.requestsPerFrame.clear();
  }
}
