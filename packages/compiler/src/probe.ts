import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { findFFmpegBinary } from './ffmpeg.js';

export interface VideoStreamInfo {
  codec: string;
  pixFmt: string;
  is10Bit: boolean;
  width: number;
  height: number;
  fps: number;
  duration: number;
  rotation: number;
  effectiveWidth: number;
  effectiveHeight: number;
  isVFR: boolean;
  hasAudio: boolean;
  colorSpace?: string;
  colorRange?: 'tv' | 'pc';
  colorPrimaries?: string;
  rawStderr: string;
}

/**
 * Probes media file metadata and validates video stream presence.
 * Throws clean, descriptive Error instances if input is missing, empty, or non-video.
 */
export async function probeMedia(inputPath: string): Promise<VideoStreamInfo> {
  // 1. File existence and size check
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: "${inputPath}"`);
  }

  const stat = fs.statSync(inputPath);
  if (stat.size === 0) {
    throw new Error(`Invalid or zero-length video input: "${inputPath}" (0 bytes)`);
  }

  const binary = findFFmpegBinary();

  // Run ffmpeg -i <path> -hide_banner to capture stream layout
  const stderr = await new Promise<string>((resolve) => {
    const proc = spawn(binary, ['-i', inputPath, '-hide_banner'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    let errOut = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      errOut += chunk.toString();
    });

    proc.on('close', () => {
      resolve(errOut);
    });

    proc.on('error', () => {
      resolve(errOut);
    });
  });

  if (stderr.includes('Invalid data found when processing input')) {
    throw new Error(`Invalid or corrupt media file: "${inputPath}"`);
  }

  // 2. Parse Video Stream
  const streamLines = stderr.split('\n').filter((l) => l.includes(': Video:'));
  if (streamLines.length === 0) {
    const hasAudioOnly = stderr.includes(': Audio:');
    if (hasAudioOnly) {
      throw new Error(`No video stream found in input: "${inputPath}" (media contains audio streams only)`);
    }
    throw new Error(`No video stream found in input: "${inputPath}" (media has no active video tracks)`);
  }

  const vLine = streamLines[0];
  const afterVideo = vLine.split(': Video:')[1] || '';

  // Parse codec (first token up to comma or parenthesis)
  const codecMatch = afterVideo.match(/^\s*([^,\s(]+)/);
  const codec = codecMatch ? codecMatch[1].trim() : 'unknown';

  // Parse pixel format (matches word before a comma, e.g. yuv420p, rgb24)
  const pixFmtMatch = afterVideo.match(/(yuv[a-z0-9_]+|rgb\d+|rgba|bgr\d+|gray[a-z0-9_]*)/i);
  const pixFmt = pixFmtMatch ? pixFmtMatch[1].toLowerCase() : 'yuv420p';
  const is10Bit = pixFmt.includes('10le') || pixFmt.includes('10be') || pixFmt.includes('10');

  // Parse dimensions (\d+x\d+)
  const dimMatch = afterVideo.match(/(\d{2,5})x(\d{2,5})/);
  if (!dimMatch) {
    throw new Error(`No video stream found in input: "${inputPath}" (unrecognized media container format)`);
  }
  const width = parseInt(dimMatch[1], 10);
  const height = parseInt(dimMatch[2], 10);

  // Parse fps
  const fpsMatch = afterVideo.match(/([\d.]+)\s+fps/);
  const tbrMatch = afterVideo.match(/([\d.]+)\s+tbr/);
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : (tbrMatch ? parseFloat(tbrMatch[1]) : 30);

  // Check VFR (if tbr significantly differs from fps or container reports variable frame rate)
  const isVFR = tbrMatch && fpsMatch ? Math.abs(parseFloat(tbrMatch[1]) - parseFloat(fpsMatch[1])) > 0.05 : false;

  // Parse Duration: 00:01:23.45
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  let duration = 0;
  if (durMatch) {
    const hours = parseInt(durMatch[1], 10);
    const mins = parseInt(durMatch[2], 10);
    const secs = parseFloat(durMatch[3]);
    duration = hours * 3600 + mins * 60 + secs;
  }

  // Parse rotation (side data displaymatrix or tags rotate)
  let rotation = 0;
  const rotMatch = stderr.match(/rotation of (-?\d+(?:\.\d+)?)\s*degrees/) || stderr.match(/rotate\s*:\s*(-?\d+)/);
  if (rotMatch) {
    const rawRot = Math.round(parseFloat(rotMatch[1]));
    rotation = ((rawRot % 360) + 360) % 360;
  }

  const isPortraitRotation = rotation === 90 || rotation === 270;
  const effectiveWidth = isPortraitRotation ? height : width;
  const effectiveHeight = isPortraitRotation ? width : height;

  // Parse color metadata
  let colorRange: 'tv' | 'pc' = 'tv';
  if (/\bpc\b|\bfull\b|\byuvj/i.test(afterVideo) || /range:\s*pc/i.test(stderr)) {
    colorRange = 'pc';
  }

  let colorSpace: string | undefined;
  const csMatch = afterVideo.match(/\b(bt709|bt470bg|smpte170m|smpte240m|bt2020nc|bt2020c|bt2020)\b/i)
    || stderr.match(/colorspace:\s*([a-zA-Z0-9_]+)/i);
  if (csMatch) {
    colorSpace = csMatch[1].toLowerCase();
  } else {
    // Untagged fallback: BT.709 for HD (>=720p or >=1280w), BT.601 (bt470bg) for SD (<720p)
    colorSpace = (effectiveHeight >= 720 || effectiveWidth >= 1280) ? 'bt709' : 'bt470bg';
  }

  let colorPrimaries: string | undefined;
  const cpMatch = stderr.match(/color_primaries:\s*([a-zA-Z0-9_]+)/i);
  if (cpMatch) {
    colorPrimaries = cpMatch[1].toLowerCase();
  } else {
    colorPrimaries = colorSpace;
  }

  return {
    codec,
    pixFmt,
    is10Bit,
    width,
    height,
    fps: isNaN(fps) ? 30 : fps,
    duration,
    rotation,
    effectiveWidth,
    effectiveHeight,
    isVFR,
    hasAudio: stderr.includes(': Audio:'),
    colorSpace,
    colorRange,
    colorPrimaries,
    rawStderr: stderr,
  };
}
