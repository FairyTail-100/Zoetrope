import { describe, it, expect } from 'vitest';
import {
  ExponentialSmoother,
  VelocityTracker,
  MotionLUT,
} from '../packages/motion/src/index.js';

describe('ExponentialSmoother', () => {
  it('smooths towards target using exponential decay formula', () => {
    const smoother = new ExponentialSmoother(0, { tau: 28 });

    // Step 1: 16.67ms (1 frame at 60Hz) towards target 1.0
    const val1 = smoother.update(1.0, 16.67);
    // formula: 1.0 + (0 - 1.0) * exp(-16.67 / 28) = 1.0 - exp(-0.595) = ~0.448
    expect(val1).toBeGreaterThan(0.4);
    expect(val1).toBeLessThan(0.5);

    // Step 2: another 16.67ms
    const val2 = smoother.update(1.0, 16.67);
    expect(val2).toBeGreaterThan(val1);
    expect(val2).toBeLessThan(1.0);
  });

  it('snaps to target when within epsilon', () => {
    const smoother = new ExponentialSmoother(0.99995, { tau: 28, epsilon: 0.0001 });
    const result = smoother.update(1.0, 16.67);
    expect(result).toBe(1.0);
  });

  it('bypasses smoothing when disabled', () => {
    const smoother = new ExponentialSmoother(0, { enabled: false });
    const result = smoother.update(1.0, 16.67);
    expect(result).toBe(1.0);
  });
});

describe('VelocityTracker', () => {
  it('detects forward direction on increasing position', () => {
    const tracker = new VelocityTracker(0);
    const result = tracker.update(0.1, performance.now() + 16);
    expect(result.direction).toBe(1);
    expect(result.velocity).toBeGreaterThan(0);
  });

  it('detects backward direction on decreasing position', () => {
    const tracker = new VelocityTracker(0.5);
    const result = tracker.update(0.4, performance.now() + 16);
    expect(result.direction).toBe(-1);
    expect(result.velocity).toBeLessThan(0);
  });
});

describe('MotionLUT', () => {
  it('interpolates intermediate points smoothly', () => {
    // Non-linear LUT: slow start, rapid middle, slow end
    const lut = new MotionLUT([0.0, 0.1, 0.9, 1.0]);

    expect(lut.evaluate(0.0)).toBe(0.0);
    expect(lut.evaluate(1.0)).toBe(1.0);

    // Midpoint between index 1 (0.1) and index 2 (0.9)
    expect(lut.evaluate(0.5)).toBeCloseTo(0.5);

    // At 1/3 (index 1 exactly)
    expect(lut.evaluate(1 / 3)).toBeCloseTo(0.1);
  });

  it('evaluates deliberately non-linear LUT with hard-coded literal expected values', () => {
    // 5-node asymmetric LUT: steep jump between 50% and 75%
    const lutTable = [0.0, 0.05, 0.20, 0.80, 1.0];
    const motionLUT = new MotionLUT(lutTable);

    // Exact grid points (hard-coded literals)
    expect(motionLUT.evaluate(0.0)).toBe(0.0);
    expect(motionLUT.evaluate(0.25)).toBe(0.05);
    expect(motionLUT.evaluate(0.50)).toBe(0.20);
    expect(motionLUT.evaluate(0.75)).toBe(0.80);
    expect(motionLUT.evaluate(1.0)).toBe(1.0);

    // Interpolated midpoints (hard-coded literals)
    // p = 0.125 -> halfway between 0.0 and 0.05 = 0.025
    expect(motionLUT.evaluate(0.125)).toBeCloseTo(0.025, 5);
    // p = 0.375 -> halfway between 0.05 and 0.20 = 0.125
    expect(motionLUT.evaluate(0.375)).toBeCloseTo(0.125, 5);
    // p = 0.625 -> halfway between 0.20 and 0.80 = 0.50
    expect(motionLUT.evaluate(0.625)).toBeCloseTo(0.50, 5);
    // p = 0.875 -> halfway between 0.80 and 1.00 = 0.90
    expect(motionLUT.evaluate(0.875)).toBeCloseTo(0.90, 5);

    // Test frame index derivation on a 101-frame timeline (totalFrames = 101, maxIndex = 100)
    // Expected frame indices are hardcoded literals, NOT computed via MotionLUT
    const totalFrames = 101;
    const maxIdx = totalFrames - 1; // 100

    const frameAt0 = Math.round(motionLUT.evaluate(0.0) * maxIdx);
    expect(frameAt0).toBe(0); // 0.0 * 100

    const frameAt25 = Math.round(motionLUT.evaluate(0.25) * maxIdx);
    expect(frameAt25).toBe(5); // 0.05 * 100 = 5 (linear would be 25)

    const frameAt50 = Math.round(motionLUT.evaluate(0.50) * maxIdx);
    expect(frameAt50).toBe(20); // 0.20 * 100 = 20 (linear would be 50)

    const frameAt75 = Math.round(motionLUT.evaluate(0.75) * maxIdx);
    expect(frameAt75).toBe(80); // 0.80 * 100 = 80 (linear would be 75)

    const frameAt100 = Math.round(motionLUT.evaluate(1.0) * maxIdx);
    expect(frameAt100).toBe(100); // 1.0 * 100 = 100
  });
});
