import { describe, it, expect, vi } from 'vitest';
import {
  evaluateEasing,
  interpolateNumber,
  ZoetropeComposition,
  Cue,
} from '../packages/core/src/composition.js';

describe('Phase 5: Zoetrope Composition & Timeline Cue System', () => {
  it('evaluates easing curves correctly across boundary conditions', () => {
    expect(evaluateEasing(0, 'linear')).toBe(0);
    expect(evaluateEasing(1, 'linear')).toBe(1);
    expect(evaluateEasing(0.5, 'linear')).toBe(0.5);

    // easeIn (t^2)
    expect(evaluateEasing(0.5, 'easeIn')).toBe(0.25);

    // easeOut (t * (2 - t))
    expect(evaluateEasing(0.5, 'easeOut')).toBe(0.75);

    // easeInOut
    expect(evaluateEasing(0.25, 'easeInOut')).toBe(0.125);
    expect(evaluateEasing(0.5, 'easeInOut')).toBe(0.5);
    expect(evaluateEasing(0.75, 'easeInOut')).toBe(0.875);
  });

  it('interpolates numbers across multi-segment keyframe tracks', () => {
    const keyframes = [
      { progress: 0.0, value: 0 },
      { progress: 0.5, value: 100, easing: 'linear' as const },
      { progress: 1.0, value: 50, easing: 'linear' as const },
    ];

    expect(interpolateNumber(keyframes, -0.1)).toBe(0);
    expect(interpolateNumber(keyframes, 0.0)).toBe(0);
    expect(interpolateNumber(keyframes, 0.25)).toBe(50);
    expect(interpolateNumber(keyframes, 0.5)).toBe(100);
    expect(interpolateNumber(keyframes, 0.75)).toBe(75);
    expect(interpolateNumber(keyframes, 1.0)).toBe(50);
    expect(interpolateNumber(keyframes, 1.2)).toBe(50);
  });

  it('triggers onEnter, onProgress, and onLeave DOM cues accurately as progress sweeps', () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const onProgress = vi.fn();

    const cues: Cue[] = [
      {
        id: 'headline-cue',
        start: 0.3,
        end: 0.7,
        onEnter,
        onLeave,
        onProgress,
      },
    ];

    // Mock HTMLCanvasElement
    const fakeCanvas = {
      getContext: () => ({
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        clip: vi.fn(),
        arc: vi.fn(),
        rect: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn(),
      }),
      width: 1280,
      height: 720,
    } as unknown as HTMLCanvasElement;

    const comp = new ZoetropeComposition({
      canvas: fakeCanvas,
      layers: [],
      cues,
    });

    // Step 1: Before cue range (progress = 0.1)
    comp.setProgress(0.1);
    expect(onEnter).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();

    // Step 2: Enters cue range (progress = 0.35)
    comp.setProgress(0.35);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expect.closeTo((0.35 - 0.3) / 0.4, 5));
    expect(onLeave).not.toHaveBeenCalled();

    // Step 3: Inside cue range (progress = 0.5)
    comp.setProgress(0.5);
    expect(onEnter).toHaveBeenCalledTimes(1); // not called again
    expect(onProgress).toHaveBeenCalledWith(expect.closeTo((0.5 - 0.3) / 0.4, 5));
    expect(onLeave).not.toHaveBeenCalled();

    // Step 4: Leaves cue range (progress = 0.8)
    comp.setProgress(0.8);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);

    // Step 5: Scrub backwards into range (progress = 0.5)
    comp.setProgress(0.5);
    expect(onEnter).toHaveBeenCalledTimes(2);

    // Destroy
    comp.destroy();
    expect(comp.getProgress()).toBe(0.5);
  });
});
