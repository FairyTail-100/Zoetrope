import { FrameDecoder, DecodedFrameTarget, DecodeRequestOptions } from './types.js';

export class NativeBitmapDecoder implements FrameDecoder {
  public readonly name = 'NativeBitmapDecoder';
  private defaultOptions: DecodeRequestOptions;

  constructor(defaultOptions?: DecodeRequestOptions) {
    this.defaultOptions = defaultOptions ?? {};
  }

  public async decode(
    source: ArrayBuffer | ArrayBufferView | Blob,
    mimeType: string = 'image/webp',
    options?: DecodeRequestOptions
  ): Promise<DecodedFrameTarget> {
    const blob = source instanceof Blob ? source : new Blob([source as BlobPart], { type: mimeType });

    if (typeof createImageBitmap === 'function') {
      try {
        const merged = { ...this.defaultOptions, ...options };
        const bmpOpts: ImageBitmapOptions = {
          premultiplyAlpha: merged.premultiplyAlpha ?? 'default',
          colorSpaceConversion: merged.colorSpaceConversion ?? 'default',
        };
        if (merged.resizeWidth && merged.resizeHeight) {
          bmpOpts.resizeWidth = merged.resizeWidth;
          bmpOpts.resizeHeight = merged.resizeHeight;
          bmpOpts.resizeQuality = merged.resizeQuality ?? 'medium';
        }
        return await createImageBitmap(blob, bmpOpts);
      } catch (err) {
        throw new Error(`Bitmap decoding failed: ${(err as Error)?.message || err}`, { cause: err });
      }
    }

    return await this.fallbackImageDecode(blob);
  }

  private fallbackImageDecode(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to decode image fallback: ${e}`));
      };
      img.src = url;
    });
  }

  public dispose(): void {
    // No static resources to release
  }
}
