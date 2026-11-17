import { Zoetrope } from './engine.js';
import { ZoetropeOptions } from './types.js';

export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface Keyframe<T> {
  progress: number; // 0.0 - 1.0
  value: T;
  easing?: EasingType;
}

export function evaluateEasing(t: number, easing: EasingType = 'linear'): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'easeIn':
      return clamped * clamped;
    case 'easeOut':
      return clamped * (2 - clamped);
    case 'easeInOut':
      return clamped < 0.5 ? 2 * clamped * clamped : -1 + (4 - 2 * clamped) * clamped;
    case 'linear':
    default:
      return clamped;
  }
}

export function interpolateNumber(
  keyframes: Keyframe<number>[],
  progress: number,
  fallback: number = 0
): number {
  if (keyframes.length === 0) return fallback;
  if (keyframes.length === 1 || progress <= keyframes[0].progress) return keyframes[0].value;
  if (progress >= keyframes[keyframes.length - 1].progress) {
    return keyframes[keyframes.length - 1].value;
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const k1 = keyframes[i];
    const k2 = keyframes[i + 1];
    if (progress >= k1.progress && progress <= k2.progress) {
      const span = k2.progress - k1.progress;
      const t = span <= 0 ? 0 : (progress - k1.progress) / span;
      const easedT = evaluateEasing(t, k2.easing ?? 'linear');
      return k1.value + (k2.value - k1.value) * easedT;
    }
  }

  return fallback;
}

export interface LayerTransform {
  x?: number; // Normalized offset (-1 to 1) or px relative to canvas center
  y?: number;
  scale?: number;
  rotate?: number; // Radians
}

export interface LayerMask {
  type: 'circle' | 'rect';
  x?: number; // normalized 0..1 (default 0.5)
  y?: number; // normalized 0..1 (default 0.5)
  radius?: number; // for circle (normalized 0..1 or px)
  width?: number; // for rect (normalized 0..1 or px)
  height?: number; // for rect (normalized 0..1 or px)
}

export interface Cue {
  id?: string;
  start: number; // 0.0 - 1.0
  end: number;
  onEnter?: () => void;
  onLeave?: () => void;
  onProgress?: (normalizedProgress: number) => void;
}

export interface CompositionLayerConfig {
  id: string;
  manifest: string | any;
  scrollRange: [number, number]; // [startProgress, endProgress]
  zIndex?: number;
  priority?: number; // Memory priority weighting (default 1)
  opacity?: number | Keyframe<number>[];
  transform?: LayerTransform | {
    x?: Keyframe<number>[];
    y?: Keyframe<number>[];
    scale?: Keyframe<number>[];
    rotate?: Keyframe<number>[];
  };
  mask?: LayerMask | {
    type: 'circle' | 'rect';
    x?: Keyframe<number>[];
    y?: Keyframe<number>[];
    radius?: Keyframe<number>[];
    width?: Keyframe<number>[];
    height?: Keyframe<number>[];
  };
  options?: Partial<ZoetropeOptions>;
}

export interface CompositionOptions {
  canvas: HTMLCanvasElement;
  totalMemoryMb?: number;
  layers: CompositionLayerConfig[];
  cues?: Cue[];
  onProgress?: (progress: number) => void;
}

interface ActiveCueState {
  cue: Cue;
  isActive: boolean;
}

export class ZoetropeComposition {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: CompositionLayerConfig[];
  private engines: Map<string, Zoetrope> = new Map();
  private offscreenCanvases: Map<string, HTMLCanvasElement> = new Map();
  private cues: ActiveCueState[] = [];
  private totalMemoryMb: number;
  private currentProgress: number = 0;
  private isDestroyed: boolean = false;
  private animationFrameId: number | null = null;
  private onProgressCallback?: (progress: number) => void;

  constructor(options: CompositionOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context for Composition canvas.');
    this.ctx = ctx;

    this.layers = [...options.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    this.totalMemoryMb = options.totalMemoryMb ?? 256;
    this.onProgressCallback = options.onProgress;

    if (options.cues) {
      this.cues = options.cues.map((cue) => ({ cue, isActive: false }));
    }
  }

  public async init(): Promise<void> {
    const totalPriority = this.layers.reduce((sum, l) => sum + (l.priority ?? 1), 0);

    for (const layer of this.layers) {
      // Create offscreen canvas for each layer so it renders its frame cleanly
      const offCanvas = document.createElement('canvas');
      offCanvas.width = this.canvas.width || 1280;
      offCanvas.height = this.canvas.height || 720;
      this.offscreenCanvases.set(layer.id, offCanvas);

      // Distribute memory budget by priority
      const layerPriority = layer.priority ?? 1;
      const layerMemoryMb = Math.max(32, Math.floor((this.totalMemoryMb * layerPriority) / totalPriority));

      const engine = new Zoetrope({
        canvas: offCanvas,
        manifest: layer.manifest,
        playback: {
          mode: 'manual', // Manual progression driven by composition
        },
        cache: {
          maxMemoryBytes: layerMemoryMb * 1024 * 1024,
        },
        ...layer.options,
      });

      engine.on('frame', () => {
        this.render();
      });
      await engine.init();
      this.engines.set(layer.id, engine);
    }

    this.setProgress(0);
  }

  public setProgress(progress: number): void {
    if (this.isDestroyed) return;
    this.currentProgress = Math.max(0, Math.min(1, progress));
    this.updateEnginesAndCues();
    this.render();
    if (this.onProgressCallback) {
      this.onProgressCallback(this.currentProgress);
    }
  }

  public getProgress(): number {
    return this.currentProgress;
  }

  private updateEnginesAndCues(): void {
    const p = this.currentProgress;

    // 1. Update layers
    for (const layer of this.layers) {
      const [start, end] = layer.scrollRange;
      const engine = this.engines.get(layer.id);
      if (!engine) continue;

      if (p < start) {
        engine.seek(0, true);
      } else if (p > end) {
        engine.seek(1, true);
      } else {
        const localProgress = end === start ? 0 : (p - start) / (end - start);
        engine.seek(localProgress, true);
      }
    }

    // 2. Update cues
    for (const item of this.cues) {
      const { cue, isActive } = item;
      const inRange = p >= cue.start && p <= cue.end;

      if (inRange && !isActive) {
        item.isActive = true;
        cue.onEnter?.();
      } else if (!inRange && isActive) {
        item.isActive = false;
        cue.onLeave?.();
      }

      if (inRange && cue.onProgress) {
        const rangeSpan = cue.end - cue.start;
        const normalized = rangeSpan <= 0 ? 0 : (p - cue.start) / rangeSpan;
        cue.onProgress(normalized);
      }
    }
  }

  public render(): void {
    if (this.isDestroyed) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear shared composition canvas
    ctx.clearRect(0, 0, w, h);

    const p = this.currentProgress;

    // Render layers in zIndex order
    for (const layer of this.layers) {
      const offCanvas = this.offscreenCanvases.get(layer.id);
      if (!offCanvas) continue;

      // Ensure offscreen canvas matches main canvas backing size
      if (offCanvas.width !== w || offCanvas.height !== h) {
        offCanvas.width = w;
        offCanvas.height = h;
      }

      // Check if layer is active or in visibility range
      const opacity = this.resolveOpacity(layer, p);
      if (opacity <= 0.001) continue;

      const transform = this.resolveTransform(layer, p);
      const mask = this.resolveMask(layer, p);

      ctx.save();

      // Apply clipping mask if configured
      if (mask) {
        ctx.beginPath();
        const mx = (mask.x ?? 0.5) * w;
        const my = (mask.y ?? 0.5) * h;
        if (mask.type === 'circle') {
          const r = (mask.radius ?? 0.5) * Math.min(w, h);
          ctx.arc(mx, my, Math.max(0, r), 0, Math.PI * 2);
        } else if (mask.type === 'rect') {
          const mw = (mask.width ?? 1) * w;
          const mh = (mask.height ?? 1) * h;
          ctx.rect(mx - mw / 2, my - mh / 2, Math.max(0, mw), Math.max(0, mh));
        }
        ctx.clip();
      }

      // Apply Opacity
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

      // Apply Transforms
      const tx = (transform.x ?? 0) * w;
      const ty = (transform.y ?? 0) * h;
      const scale = transform.scale ?? 1;
      const rotate = transform.rotate ?? 0;

      ctx.translate(w / 2 + tx, h / 2 + ty);
      if (rotate !== 0) ctx.rotate(rotate);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.translate(-w / 2, -h / 2);

      // Blit offscreen layer frame to main canvas
      ctx.drawImage(offCanvas, 0, 0, w, h);

      ctx.restore();
    }
  }

  private resolveOpacity(layer: CompositionLayerConfig, progress: number): number {
    if (typeof layer.opacity === 'number') return layer.opacity;
    if (Array.isArray(layer.opacity)) {
      return interpolateNumber(layer.opacity, progress, 1);
    }
    // Default opacity: 1 inside range, 0 outside
    const [start, end] = layer.scrollRange;
    return progress >= start && progress <= end ? 1 : 0;
  }

  private resolveTransform(layer: CompositionLayerConfig, progress: number): LayerTransform {
    if (!layer.transform) return {};
    const t = layer.transform;
    return {
      x: Array.isArray(t.x) ? interpolateNumber(t.x, progress, 0) : t.x ?? 0,
      y: Array.isArray(t.y) ? interpolateNumber(t.y, progress, 0) : t.y ?? 0,
      scale: Array.isArray(t.scale) ? interpolateNumber(t.scale, progress, 1) : t.scale ?? 1,
      rotate: Array.isArray(t.rotate) ? interpolateNumber(t.rotate, progress, 0) : t.rotate ?? 0,
    };
  }

  private resolveMask(layer: CompositionLayerConfig, progress: number): LayerMask | null {
    if (!layer.mask) return null;
    const m = layer.mask;
    return {
      type: m.type,
      x: Array.isArray(m.x) ? interpolateNumber(m.x, progress, 0.5) : m.x ?? 0.5,
      y: Array.isArray(m.y) ? interpolateNumber(m.y, progress, 0.5) : m.y ?? 0.5,
      radius: Array.isArray(m.radius) ? interpolateNumber(m.radius, progress, 0.5) : m.radius ?? 0.5,
      width: Array.isArray(m.width) ? interpolateNumber(m.width, progress, 1) : m.width ?? 1,
      height: Array.isArray(m.height) ? interpolateNumber(m.height, progress, 1) : m.height ?? 1,
    };
  }

  public getEngine(layerId: string): Zoetrope | undefined {
    return this.engines.get(layerId);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    for (const engine of this.engines.values()) {
      engine.destroy();
    }
    this.engines.clear();
    this.offscreenCanvases.clear();
    this.cues = [];
  }
}
