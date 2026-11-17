import * as fs from 'node:fs';
import * as path from 'node:path';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';
import { compile } from '../packages/compiler/src/compiler.js';

function copyRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

export async function ensureShowcaseAssets(targetDir?: string): Promise<void> {
  const sharedDir = path.resolve('shared/assets/showcase');
  const manifestPath = path.join(sharedDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    fs.mkdirSync(sharedDir, { recursive: true });
    const tempClip = path.join(sharedDir, 'temp-testsrc.mp4');
    await runFFmpeg([
      '-f', 'lavfi',
      '-i', 'testsrc=duration=1:size=320x240:rate=12',
      '-pix_fmt', 'yuv420p',
      '-y',
      tempClip
    ]);
    await compile({
      input: tempClip,
      outputDir: sharedDir,
      id: 'synthetic-showcase',
      fps: 12,
      format: 'webp',
      quality: 80,
      variants: [
        { id: 'desktop', width: 320, height: 240, minWidth: 768 },
        { id: 'mobile', width: 320, height: 240, minWidth: 0 }
      ]
    });
    try {
      fs.unlinkSync(tempClip);
    } catch {}
  }

  if (targetDir && targetDir !== sharedDir) {
    if (!fs.existsSync(targetDir)) {
      copyRecursive(sharedDir, targetDir);
    }
  }
}

// Run directly when called as CLI
if (process.argv[1]?.includes('ensure-showcase-assets')) {
  (async () => {
    await ensureShowcaseAssets();
    const targets = [
      'examples/basic-scroll/public/assets/showcase',
      'examples/layered-composition/public/assets/showcase',
      'examples/nextjs/public/assets/showcase',
      'examples/astro/public/assets/showcase',
    ];
    for (const t of targets) {
      await ensureShowcaseAssets(path.resolve(t));
    }
  })().catch(console.error);
}
