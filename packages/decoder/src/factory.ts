import { FrameDecoder, DecoderOptions } from './types.js';
import { NativeBitmapDecoder } from './bitmap-decoder.js';
import { WorkerPoolDecoder } from './worker-decoder.js';
import { WebCodecsImageDecoder } from './webcodecs-decoder.js';
import { FallbackImageDecoder } from './fallback-decoder.js';

export function createDecoder(options?: DecoderOptions): FrameDecoder {
  if (options?.useWebCodecs && WebCodecsImageDecoder.isSupported()) {
    return new WebCodecsImageDecoder();
  }

  if (typeof createImageBitmap === 'function') {
    if (options?.preferWorker && typeof Worker !== 'undefined') {
      return new WorkerPoolDecoder(options.workerCount ?? 4, options.defaultDecodeOptions);
    }
    return new NativeBitmapDecoder(options?.defaultDecodeOptions);
  }
  return new FallbackImageDecoder();
}
