/**
 * Evaluates a non-linear Motion Lookup Table (LUT).
 * Used to normalize perceived motion speeds across uneven camera moves (MotionLUT).
 */
export class MotionLUT {
  private lut: number[];

  constructor(lut?: number[]) {
    this.lut = lut && lut.length >= 2 ? lut : [0, 1];
  }

  /**
   * Maps progress in [0, 1] through the LUT using linear interpolation.
   */
  public evaluate(progress: number): number {
    const clamped = Math.max(0, Math.min(1, progress));
    const count = this.lut.length;
    const virtualIndex = clamped * (count - 1);

    const index0 = Math.floor(virtualIndex);
    const index1 = Math.min(count - 1, Math.ceil(virtualIndex));
    const frac = virtualIndex - index0;

    const val0 = this.lut[index0];
    const val1 = this.lut[index1];

    return val0 + (val1 - val0) * frac;
  }

  public setLUT(lut: number[]): void {
    if (lut.length >= 2) {
      this.lut = lut;
    }
  }

  public getRawLUT(): number[] {
    return this.lut;
  }
}
