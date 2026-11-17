import { SmoothingConfig } from './types.js';

/**
 * Exponential decay filter (decay rate tau in milliseconds):
 * y(t) = target + (y0 - target) * exp(-dt / tau)
 *
 * Guarantees identical physics regardless of display refresh rate (60Hz, 120Hz, 240Hz).
 */
export class ExponentialSmoother {
  private current: number;
  private tau: number;
  private epsilon: number;
  private enabled: boolean;

  constructor(initialValue: number = 0, config?: Partial<SmoothingConfig>) {
    this.current = initialValue;
    this.tau = Math.max(1, config?.tau ?? 28);
    this.epsilon = config?.epsilon ?? 0.0001;
    this.enabled = config?.enabled ?? true;
  }

  public update(target: number, deltaTimeMs: number): number {
    if (!this.enabled || deltaTimeMs <= 0) {
      this.current = target;
      return this.current;
    }

    // Mathematical exponential decay:
    // factor = exp(-dt / tau)
    const factor = Math.exp(-deltaTimeMs / this.tau);
    this.current = target + (this.current - target) * factor;

    if (Math.abs(target - this.current) < this.epsilon) {
      this.current = target;
    }

    return this.current;
  }

  public reset(value: number): void {
    this.current = value;
  }

  public getValue(): number {
    return this.current;
  }

  public setTau(tau: number): void {
    this.tau = Math.max(1, tau);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
