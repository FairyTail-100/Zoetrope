export interface SmoothingConfig {
  enabled: boolean;
  /**
   * Time constant tau in milliseconds.
   * Lower values = faster, tighter tracking (e.g. 15ms).
   * Higher values = smoother, more cinematic deceleration (e.g. 35ms).
   */
  tau: number;
  /** Precision threshold to snap to target value. Default 0.0001 */
  epsilon?: number;
}

export interface MotionUpdate {
  targetProgress: number;
  smoothedProgress: number;
  currentFrame: number;
  velocity: number;
  direction: 1 | -1 | 0;
  deltaTimeMs: number;
}

export type MotionCallback = (update: MotionUpdate) => void;
