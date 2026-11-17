/**
 * Tracks instantaneous velocity and direction with low-pass filtering.
 */
export class VelocityTracker {
  private lastPosition: number = 0;
  private lastTime: number = 0;
  private smoothedVelocity: number = 0;
  private currentDirection: 1 | -1 | 0 = 0;
  private smoothingAlpha: number = 0.3; // Low-pass filter weight

  constructor(initialPosition: number = 0) {
    this.lastPosition = initialPosition;
    this.lastTime = performance.now();
  }

  public update(currentPosition: number, now: number = performance.now()): {
    velocity: number;
    direction: 1 | -1 | 0;
  } {
    const dt = Math.max(1, now - this.lastTime);
    const delta = currentPosition - this.lastPosition;

    // Instantaneous velocity: units per second
    const rawVelocity = (delta / dt) * 1000;

    // Low-pass exponential moving average filter
    this.smoothedVelocity =
      this.smoothingAlpha * rawVelocity + (1 - this.smoothingAlpha) * this.smoothedVelocity;

    if (Math.abs(this.smoothedVelocity) > 0.001) {
      this.currentDirection = this.smoothedVelocity > 0 ? 1 : -1;
    } else {
      this.currentDirection = 0;
    }

    this.lastPosition = currentPosition;
    this.lastTime = now;

    return {
      velocity: this.smoothedVelocity,
      direction: this.currentDirection,
    };
  }

  public getVelocity(): number {
    return this.smoothedVelocity;
  }

  public getDirection(): 1 | -1 | 0 {
    return this.currentDirection;
  }

  public reset(position: number = 0): void {
    this.lastPosition = position;
    this.lastTime = performance.now();
    this.smoothedVelocity = 0;
    this.currentDirection = 0;
  }
}
