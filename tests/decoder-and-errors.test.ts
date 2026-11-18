import { describe, it, expect } from 'vitest';
import {
  FallbackImageDecoder,
  negotiateVariantFormat,
  probeFormatSupport,
  ZoetropeError,
  ManifestError,
  DecodeError,
  StreamError,
  RendererError,
} from '../packages/core/src/index.js';

describe('Error classes', () => {
  it('constructs ZoetropeError and subclasses with expected names and inheritance', () => {
    const base = new ZoetropeError('base', 'BASE_CODE');
    expect(base).toBeInstanceOf(Error);
    expect(base.name).toBe('ZoetropeError');
    expect(base.code).toBe('BASE_CODE');

    const manifestErr = new ManifestError('bad manifest', 'BAD_MANIFEST');
    expect(manifestErr).toBeInstanceOf(ZoetropeError);
    expect(manifestErr.name).toBe('ManifestError');

    const decodeErr = new DecodeError('decode failed', 'DECODE_FAIL');
    expect(decodeErr).toBeInstanceOf(ZoetropeError);
    expect(decodeErr.name).toBe('DecodeError');

    const streamErr = new StreamError('stream failed', 'STREAM_FAIL');
    expect(streamErr).toBeInstanceOf(ZoetropeError);
    expect(streamErr.name).toBe('StreamError');

    const rendererErr = new RendererError('renderer failed', 'RENDER_FAIL');
    expect(rendererErr).toBeInstanceOf(ZoetropeError);
    expect(rendererErr.name).toBe('RendererError');
  });
});

describe('Decoder fallback and format negotiation', () => {
  it('probeFormatSupport returns a boolean for a given mime type', async () => {
    const supported = await probeFormatSupport('image/webp');
    expect(typeof supported).toBe('boolean');
  });

  it('negotiateVariantFormat falls back to variant default when sources is absent', async () => {
    const variant = {
      id: 'desktop',
      minWidth: 768,
      width: 1920,
      height: 1080,
      format: 'webp' as const,
      packing: 'individual' as const,
      frameTemplate: 'desktop/frame_%04d.webp',
      frameStartIndex: 1,
      frames: [],
    };
    const chosen = await negotiateVariantFormat(variant);
    expect(chosen.format).toBe('webp');
    expect(chosen.frameTemplate).toBe('desktop/frame_%04d.webp');
  });

  it('FallbackImageDecoder exposes decode and dispose methods', () => {
    const decoder = new FallbackImageDecoder();
    expect(typeof decoder.decode).toBe('function');
    expect(typeof decoder.dispose).toBe('function');
    decoder.dispose();
  });
});
