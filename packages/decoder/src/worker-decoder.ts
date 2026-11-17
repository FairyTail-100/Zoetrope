import { FrameDecoder, DecodedFrameTarget, DecodeRequestOptions } from './types.js';
import { NativeBitmapDecoder } from './bitmap-decoder.js';

const WORKER_SCRIPT = `
self.onmessage = async (e) => {
  const { id, buffer, mimeType, options } = e.data;
  try {
    const blob = new Blob([buffer], { type: mimeType || 'image/webp' });
    const bmpOpts = {
      premultiplyAlpha: (options && options.premultiplyAlpha) || 'default',
      colorSpaceConversion: (options && options.colorSpaceConversion) || 'default',
    };
    if (options && options.resizeWidth && options.resizeHeight) {
      bmpOpts.resizeWidth = options.resizeWidth;
      bmpOpts.resizeHeight = options.resizeHeight;
      bmpOpts.resizeQuality = options.resizeQuality || 'medium';
    }
    const bitmap = await createImageBitmap(blob, bmpOpts);
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) ? err.message : String(err) });
  }
};
`;

interface PendingDecode {
  resolve: (bmp: DecodedFrameTarget) => void;
  reject: (err: Error) => void;
}

export class WorkerPoolDecoder implements FrameDecoder {
  public readonly name = 'WorkerPoolDecoder';
  private workers: Worker[] = [];
  private pending: Map<number, PendingDecode> = new Map();
  private nextRequestId = 1;
  private roundRobinIdx = 0;
  private fallbackDecoder: NativeBitmapDecoder;
  private defaultOptions: DecodeRequestOptions;
  private blobUrl: string | null = null;
  private disposed = false;

  constructor(workerCount: number = 4, defaultOptions?: DecodeRequestOptions) {
    this.defaultOptions = defaultOptions ?? {};
    this.fallbackDecoder = new NativeBitmapDecoder(defaultOptions);

    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
        this.blobUrl = URL.createObjectURL(blob);
        const count = Math.max(1, Math.min(8, workerCount));
        for (let i = 0; i < count; i++) {
          const w = new Worker(this.blobUrl);
          w.onmessage = (e: MessageEvent) => {
            const { id, bitmap, error } = e.data;
            const req = this.pending.get(id);
            if (!req) {
              if (bitmap && typeof bitmap.close === 'function') {
                try {
                  bitmap.close();
                } catch {}
              }
              return;
            }
            this.pending.delete(id);
            if (error) {
              req.reject(new Error(`Worker bitmap decoding failed: ${error}`));
            } else {
              req.resolve(bitmap as ImageBitmap);
            }
          };
          w.onerror = (err) => {
            // Reject any pending requests on fatal worker error
            for (const [, req] of this.pending.entries()) {
              req.reject(new Error(`Worker error: ${err.message}`));
            }
            this.pending.clear();
          };
          this.workers.push(w);
        }
      } catch {
        this.workers = [];
      }
    }
  }

  public async decode(
    source: ArrayBuffer | ArrayBufferView | Blob,
    mimeType: string = 'image/webp',
    options?: DecodeRequestOptions
  ): Promise<DecodedFrameTarget> {
    if (this.disposed) {
      throw new Error('Decoder has been disposed');
    }

    if (this.workers.length === 0) {
      return this.fallbackDecoder.decode(source, mimeType, options);
    }

    let rawBuffer: ArrayBuffer;
    if (source instanceof ArrayBuffer) {
      // Slice a copy so transferring to Worker does not neuter caller's buffer if reused
      rawBuffer = source.slice(0);
    } else if (ArrayBuffer.isView(source)) {
      rawBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    } else if (source instanceof Blob) {
      rawBuffer = await source.arrayBuffer();
    } else {
      return this.fallbackDecoder.decode(source, mimeType, options);
    }

    const id = this.nextRequestId++;
    const worker = this.workers[this.roundRobinIdx % this.workers.length];
    this.roundRobinIdx++;
    const mergedOptions = { ...this.defaultOptions, ...options };

    return new Promise<DecodedFrameTarget>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(
        { id, buffer: rawBuffer, mimeType, options: mergedOptions },
        [rawBuffer]
      );
    });
  }

  public dispose(): void {
    this.disposed = true;
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {}
    }
    this.workers = [];
    if (this.blobUrl && typeof URL !== 'undefined') {
      try {
        URL.revokeObjectURL(this.blobUrl);
      } catch {}
      this.blobUrl = null;
    }
    for (const [, req] of this.pending.entries()) {
      req.reject(new Error('WorkerPoolDecoder disposed'));
    }
    this.pending.clear();
    this.fallbackDecoder.dispose();
  }
}
