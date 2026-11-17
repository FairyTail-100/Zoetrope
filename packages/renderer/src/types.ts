export type FitMode = 'cover' | 'contain' | 'fill';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  fit?: FitMode;
  maxDpr?: number;
  clearOnStall?: boolean;
}

export interface RenderMetrics {
  drawTimeMs: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  lastDrawnFrameId: number | null;
}
