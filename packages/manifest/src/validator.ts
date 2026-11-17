import { AnimationManifest, ResolutionVariant } from './types.js';

export function validateManifest(data: unknown): AnimationManifest {
  if (typeof data !== 'object' || data === null) {
    const received = data === null ? 'null' : typeof data;
    throw new Error(`Manifest must be a non-null object, received ${received}`);
  }

  const m = data as Partial<AnimationManifest>;

  if (m.version !== '1.0.0') {
    throw new Error(`Unsupported manifest version: ${m.version}. Expected '1.0.0'`);
  }

  if (!m.id || typeof m.id !== 'string') {
    const received = m.id === undefined ? 'undefined' : `${typeof m.id} (${JSON.stringify(m.id)})`;
    throw new Error(`Manifest must have a valid string "id", received ${received}`);
  }

  if (!m.metadata || typeof m.metadata !== 'object') {
    throw new Error('Manifest metadata missing or invalid');
  }

  const { totalFrames, fps, duration } = m.metadata;
  if (typeof totalFrames !== 'number' || totalFrames <= 0) {
    throw new Error('Manifest metadata.totalFrames must be a positive integer');
  }
  if (typeof fps !== 'number' || fps <= 0) {
    throw new Error('Manifest metadata.fps must be a positive number');
  }
  if (typeof duration !== 'number' || duration <= 0) {
    throw new Error('Manifest metadata.duration must be a positive number');
  }

  if (!Array.isArray(m.variants) || m.variants.length === 0) {
    throw new Error('Manifest must contain at least one resolution variant');
  }

  for (const v of m.variants) {
    if (!v.id || typeof v.width !== 'number' || typeof v.height !== 'number') {
      throw new Error(`Variant has invalid structure: ${JSON.stringify(v)}`);
    }
    if (v.packing === 'chunked') {
      if (!Array.isArray(v.chunks) || v.chunks.length === 0) {
        throw new Error(`Chunked variant "${v.id}" must provide chunks array`);
      }
      if (Array.isArray(v.frames) && v.frames.length > 0) {
        throw new Error(`Variant "${v.id}" cannot have both chunks and frames. Use one representation.`);
      }
    } else if (v.packing === 'individual') {
      const hasFrames = Array.isArray(v.frames) && v.frames.length > 0;
      const hasTemplate = typeof v.frameTemplate === 'string' && v.frameTemplate.length > 0;
      if (!hasFrames && !hasTemplate) {
        throw new Error(`Individual variant "${v.id}" must provide frames array or frameTemplate`);
      }
      if (Array.isArray(v.chunks) && v.chunks.length > 0) {
        throw new Error(`Variant "${v.id}" cannot have both chunks and frames. Use one representation.`);
      }
    } else if (v.packing === 'range') {
      if (!Array.isArray(v.frames) || v.frames.length === 0) {
        throw new Error(`Range variant "${v.id}" must provide frames array with byteOffset and byteLength`);
      }
    } else {
      throw new Error(`Variant "${v.id}" packing must be 'individual', 'chunked', or 'range'`);
    }
  }

  if (m.motion?.lut) {
    if (!Array.isArray(m.motion.lut) || m.motion.lut.length < 2) {
      throw new Error('Motion LUT must be an array with at least 2 entries');
    }
    // Verify monotonic non-decreasing
    for (let i = 1; i < m.motion.lut.length; i++) {
      if (m.motion.lut[i] < m.motion.lut[i - 1]) {
        throw new Error('Motion LUT values must be monotonically non-decreasing');
      }
    }
  }

  return m as AnimationManifest;
}

/**
 * Selects the best resolution variant based on screen dimensions and DPR.
 * Prioritizes matching width >= (screenWidth * dpr).
 */
export function selectVariant(
  manifest: AnimationManifest,
  screenWidth: number,
  dpr: number = 1.0
): ResolutionVariant {
  // Filter by minWidth and maxWidth layout constraints if defined
  const eligible = manifest.variants.filter((v) => {
    if (v.minWidth !== undefined && screenWidth < v.minWidth) return false;
    if (v.maxWidth !== undefined && screenWidth > v.maxWidth) return false;
    return true;
  });

  const candidates = eligible.length > 0 ? eligible : manifest.variants;
  const targetWidth = screenWidth * Math.min(dpr, 2.0); // Cap DPR at 2.0 to avoid mobile VRAM waste

  // Sort candidates by width descending (e.g. [1920, 960])
  const sorted = [...candidates].sort((a, b) => b.width - a.width);

  // Default to largest candidate if targetWidth >= sorted[0].width (e.g. 1920x1080 at DPR >= 1)
  let match = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].width >= targetWidth) {
      match = sorted[i];
    } else {
      break;
    }
  }

  return match;
}

/**
 * Selects resolution variant with hysteresis protection for resize operations.
 * Switches to mobile only below 740px, and switches back to desktop only above 800px.
 */
export function selectVariantWithHysteresis(
  manifest: AnimationManifest,
  screenWidth: number,
  currentVariantId?: string,
  dpr: number = 1.0
): ResolutionVariant {
  const desktop = manifest.variants.find((v) => v.id === 'desktop') || manifest.variants[0];
  const mobile =
    manifest.variants.find((v) => v.id === 'mobile') ||
    manifest.variants[manifest.variants.length - 1];

  if (!currentVariantId) {
    return screenWidth >= 740 ? desktop : mobile;
  }

  if (currentVariantId === desktop.id) {
    if (screenWidth < 740) {
      return mobile;
    }
    return desktop;
  }

  if (currentVariantId === mobile.id) {
    if (screenWidth > 800) {
      return desktop;
    }
    return mobile;
  }

  return selectVariant(manifest, screenWidth, dpr);
}
