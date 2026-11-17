import { RendererOptions, RenderMetrics, FitMode } from './types.js';

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fit: FitMode;
  private maxDpr: number;
  private clearOnStall: boolean;

  private currentDpr: number = 1.0;
  private lastDrawnFrameId: number | null = null;
  private lastDrawTimeMs: number = 0;

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.fit = options.fit ?? 'cover';
    this.maxDpr = options.maxDpr ?? 2.0;
    this.clearOnStall = options.clearOnStall ?? false;

    // Use desynchronized & alpha:false for maximum 2D blit performance
    const ctx = this.canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    });

    if (!ctx) {
      throw new Error('Unable to obtain CanvasRenderingContext2D');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';

    this.resize();
  }

  public resize(): void {
    if (typeof window === 'undefined') return;

    const rawDpr = window.devicePixelRatio || 1;
    this.currentDpr = Math.min(rawDpr, this.maxDpr);

    const rect = this.canvas.getBoundingClientRect();
    const displayWidth = rect.width > 0 ? rect.width : window.innerWidth;
    const displayHeight = rect.height > 0 ? rect.height : window.innerHeight;

    const internalWidth = Math.round(displayWidth * this.currentDpr);
    const internalHeight = Math.round(displayHeight * this.currentDpr);

    if (this.canvas.width !== internalWidth || this.canvas.height !== internalHeight) {
      this.canvas.width = internalWidth;
      this.canvas.height = internalHeight;
    }
  }

  public render(
    frame: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
    frameId: number
  ): void {
    const startTime = performance.now();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const fw = frame.width;
    const fh = frame.height;

    if (cw === 0 || ch === 0 || fw === 0 || fh === 0) return;

    if (this.fit === 'fill') {
      this.ctx.drawImage(frame, 0, 0, cw, ch);
    } else {
      let drawW: number;
      let drawH: number;

      const canvasRatio = cw / ch;
      const frameRatio = fw / fh;

      if (this.fit === 'cover') {
        if (canvasRatio > frameRatio) {
          drawW = cw;
          drawH = cw / frameRatio;
        } else {
          drawH = ch;
          drawW = ch * frameRatio;
        }
      } else {
        // 'contain'
        if (canvasRatio > frameRatio) {
          drawH = ch;
          drawW = ch * frameRatio;
        } else {
          drawW = cw;
          drawH = cw / frameRatio;
        }
      }

      // Center
      const dx = Math.round((cw - drawW) / 2);
      const dy = Math.round((ch - drawH) / 2);

      this.ctx.drawImage(frame, dx, dy, Math.round(drawW), Math.round(drawH));
    }

    this.lastDrawnFrameId = frameId;
    this.lastDrawTimeMs = performance.now() - startTime;
  }

  public clear(): void {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastDrawnFrameId = null;
  }

  public getMetrics(): RenderMetrics {
    return {
      drawTimeMs: this.lastDrawTimeMs,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      dpr: this.currentDpr,
      lastDrawnFrameId: this.lastDrawnFrameId,
    };
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public setFit(fit: FitMode): void {
    this.fit = fit;
  }

  public setMaxDpr(maxDpr: number): void {
    this.maxDpr = Math.max(0.5, maxDpr);
    this.resize();
  }

  public getMaxDpr(): number {
    return this.maxDpr;
  }
}
