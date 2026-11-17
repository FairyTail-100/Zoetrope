/* eslint-disable @typescript-eslint/no-unused-vars */
import { FrameDecoder, DecodedFrameTarget, DecodeRequestOptions } from './types.js';

// WebCodecs ImageDecoder global type declaration
declare class ImageDecoder {
  constructor(init: { data: BufferSource | ReadableStream; type: string; desiredWidth?: number; desiredHeight?: number });
  decode(options?: { frameIndex?: number; completeFramesOnly?: boolean }): Promise<{ image: VideoFrame }>;
  close(): void;
  static isTypeSupported(type: string): Promise<boolean>;
}

declare class VideoFrame {
  readonly displayWidth: number;
  readonly displayHeight: number;
  close(): void;
}

/**
 * Experimental WebCodecs ImageDecoder implementation.
 * Enabled only when useWebCodecs: true is explicitly passed.
 * Off by default. Labeled as experimental in documentation/feature-status.md.
 */
export class WebCodecsImageDecoder implements FrameDecoder {
  public readonly name = 'WebCodecsImageDecoder (Experimental)';

  public static isSupported(): boolean {
    return typeof (globalThis as any).ImageDecoder !== 'undefined';
  }

  public async decode(
    source: ArrayBuffer | ArrayBufferView | Blob,
    mimeType: string = 'image/webp',
    options?: DecodeRequestOptions
  ): Promise<DecodedFrameTarget> {
    if (!WebCodecsImageDecoder.isSupported()) {
      throw new Error(
        'WebCodecs ImageDecoder is not supported in this browser environment. Use NativeBitmapDecoder.'
      );
    }

    let bufferSource: any;
    if (source instanceof Blob) {
      bufferSource = await source.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      bufferSource = source;
    } else {
      bufferSource = new Uint8Array(
        source.buffer,
        source.byteOffset,
        source.byteLength
      );
    }

    const initOptions: any = {
      data: bufferSource,
      type: mimeType,
    };
    if (options?.resizeWidth && options?.resizeHeight) {
      initOptions.desiredWidth = options.resizeWidth;
      initOptions.desiredHeight = options.resizeHeight;
    }

    const decoder = new (globalThis as any).ImageDecoder(initOptions);
    try {
      const result = await decoder.decode({ frameIndex: 0 });
      const videoFrame = result.image;

      // Transfer VideoFrame to ImageBitmap so it complies with CanvasImageSource & lifecycle
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(videoFrame as any);
        videoFrame.close();
        return bmp;
      }
      return videoFrame as unknown as DecodedFrameTarget;
    } finally {
      decoder.close();
    }
  }

  public dispose(): void {
    // Stateless per frame decode
  }
}
