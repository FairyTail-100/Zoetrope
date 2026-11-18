import { ImageMimeType, ResolutionVariant } from '@zoetropejs/manifest';
import { FrameDecoder } from './types.js';

const TRIAL_SAMPLES_B64: Record<ImageMimeType, string> = {
  'image/avif':
    'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAABwAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAQAAAAEAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAkbWRhdBIACggYBH2iAhoNCDIOGUeHhiGAAGgACJBAzUA=',
  'image/webp': 'UklGRiQAAABXRUJQVlA4IBgAAABQAQCdASoEAAQAAUAmJaQABHQAAORAAAA=',
  'image/jpeg':
    '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAQDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAA//2Q==',
  'image/png':
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
};

function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      u8[i] = bin.charCodeAt(i);
    }
    return u8;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Performs a real trial decode of a tiny 4x4 sample image for the given MIME type
 * using the provided decoder (or createImageBitmap). Uses ZERO User-Agent sniffing.
 */
export async function probeFormatSupport(
  mimeType: ImageMimeType,
  decoder: FrameDecoder
): Promise<boolean> {
  const b64 = TRIAL_SAMPLES_B64[mimeType];
  if (!b64) return false;

  try {
    const bytes = base64ToUint8Array(b64);
    const target = await decoder.decode(bytes, mimeType);
    if (target && typeof (target as ImageBitmap).close === 'function') {
      (target as ImageBitmap).close();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Negotiates the best supported format for a ResolutionVariant by performing
 * trial decodes in preference order (variant.sources or variant.formats),
 * returning a resolved ResolutionVariant configured with the winning format.
 */
export async function negotiateVariantFormat(
  variant: ResolutionVariant,
  decoder: FrameDecoder
): Promise<ResolutionVariant> {
  if (variant.sources && variant.sources.length > 0) {
    for (const source of variant.sources) {
      const supported = await probeFormatSupport(source.format, decoder);
      if (supported) {
        return {
          ...variant,
          format: source.format,
          frameTemplate: source.frameTemplate ?? variant.frameTemplate,
          frameStartIndex: source.frameStartIndex ?? variant.frameStartIndex,
          framesCount: source.framesCount ?? variant.framesCount,
          frames: source.frames ?? variant.frames,
          chunks: source.chunks ?? variant.chunks,
          singlePackUrl: source.singlePackUrl ?? variant.singlePackUrl,
          stats: source.stats ?? variant.stats,
        };
      }
    }
    // If all trial decodes fail (e.g. in a mock environment without real image decoding),
    // fall back to the last source in the list
    const fallbackSource = variant.sources[variant.sources.length - 1];
    return {
      ...variant,
      format: fallbackSource.format,
      frameTemplate: fallbackSource.frameTemplate ?? variant.frameTemplate,
      frameStartIndex: fallbackSource.frameStartIndex ?? variant.frameStartIndex,
      framesCount: fallbackSource.framesCount ?? variant.framesCount,
      frames: fallbackSource.frames ?? variant.frames,
      chunks: fallbackSource.chunks ?? variant.chunks,
      singlePackUrl: fallbackSource.singlePackUrl ?? variant.singlePackUrl,
      stats: fallbackSource.stats ?? variant.stats,
    };
  }

  const candidateFormats: ImageMimeType[] = variant.formats
    ? variant.formats
    : Array.isArray(variant.format)
      ? variant.format
      : [variant.format];

  if (candidateFormats.length <= 1) {
    return {
      ...variant,
      format: candidateFormats[0] ?? 'image/webp',
    };
  }

  for (const fmt of candidateFormats) {
    const supported = await probeFormatSupport(fmt, decoder);
    if (supported) {
      const ext = fmt === 'image/jpeg' ? 'jpg' : fmt.replace('image/', '');
      const updatedTemplate = variant.frameTemplate
        ? variant.frameTemplate.replace(/\.(webp|avif|jpe?g|png)$/i, `.${ext}`)
        : undefined;
      return {
        ...variant,
        format: fmt,
        frameTemplate: updatedTemplate,
      };
    }
  }

  const lastFmt = candidateFormats[candidateFormats.length - 1];
  const ext = lastFmt === 'image/jpeg' ? 'jpg' : lastFmt.replace('image/', '');
  return {
    ...variant,
    format: lastFmt,
    frameTemplate: variant.frameTemplate
      ? variant.frameTemplate.replace(/\.(webp|avif|jpe?g|png)$/i, `.${ext}`)
      : undefined,
  };
}
