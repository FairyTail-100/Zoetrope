export type DecodedFrameTarget = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export interface DecodeRequestOptions {
  resizeWidth?: number;
  resizeHeight?: number;
  resizeQuality?: 'pixelated' | 'low' | 'medium' | 'high';
  premultiplyAlpha?: 'none' | 'premultiply' | 'default';
  colorSpaceConversion?: 'none' | 'default';
}

export interface FrameDecoder {
  readonly name: string;
  decode(
    source: ArrayBuffer | ArrayBufferView | Blob,
    mimeType?: string,
    options?: DecodeRequestOptions
  ): Promise<DecodedFrameTarget>;
  dispose(): void;
}

export interface DecoderOptions {
  preferWorker?: boolean;
  useWebCodecs?: boolean; // Experimental: uses WebCodecs ImageDecoder if supported
  workerCount?: number;
  defaultDecodeOptions?: DecodeRequestOptions;
}
