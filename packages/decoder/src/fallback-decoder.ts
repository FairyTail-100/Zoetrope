import { FrameDecoder, DecodedFrameTarget } from './types.js';

export class FallbackImageDecoder implements FrameDecoder {
  public readonly name = 'FallbackImageDecoder';

  public decode(source: ArrayBuffer | Blob, mimeType: string = 'image/webp'): Promise<DecodedFrameTarget> {
    const blob = source instanceof Blob ? source : new Blob([source], { type: mimeType });
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image in FallbackImageDecoder'));
      };
      img.src = url;
    });
  }

  public dispose(): void {
    // No-op
  }
}
