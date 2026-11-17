import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function measureDecodeConcurrency() {
  console.log('⚡ Benchmarking createImageBitmap Decode Concurrency (1, 2, 4, 8)...');

  // Load a real 1080p WebP frame from variant-individual
  const framePath = path.resolve('benchmarks/assets/variant-individual/frames/frame_0001.webp');
  const frameBuf = fs.readFileSync(framePath);
  const base64Data = frameBuf.toString('base64');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results: any[] = await page.evaluate(`(async (b64) => {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/webp' });

    // Warmup
    const warmBmp = await createImageBitmap(blob);
    warmBmp.close();

    const concurrencyLevels = [1, 2, 4, 8];
    const totalFramesToDecode = 32;
    const report = [];

    for (const c of concurrencyLevels) {
      const start = performance.now();
      
      const batches = Math.ceil(totalFramesToDecode / c);
      for (let b = 0; b < batches; b++) {
        const promises = [];
        const countThisBatch = Math.min(c, totalFramesToDecode - b * c);
        for (let i = 0; i < countThisBatch; i++) {
          promises.push(createImageBitmap(blob).then((bmp) => bmp.close()));
        }
        await Promise.all(promises);
      }

      const duration = performance.now() - start;
      const throughput = (totalFramesToDecode / duration) * 1000;
      const avgMs = duration / totalFramesToDecode;

      report.push({
        concurrency: c,
        durationMs: Math.round(duration * 10) / 10,
        throughputFps: Math.round(throughput * 10) / 10,
        avgMsPerFrame: Math.round(avgMs * 100) / 100,
      });
    }

    return report;
  })('${base64Data}')`);

  await browser.close();

  console.log('\n======================================================');
  console.log('📊 CHROMIUM createImageBitmap CONCURRENCY TEST (1080p WebP)');
  console.log('======================================================');
  console.log('| Concurrency | Total Time (32 frames) | Throughput (FPS) | Avg Time / Frame |');
  console.log('| :--- | :--- | :--- | :--- |');
  for (const r of results) {
    console.log(`| **${r.concurrency} worker(s)** | ${r.durationMs} ms | **${r.throughputFps} fps** | ${r.avgMsPerFrame} ms |`);
  }
  console.log('======================================================\n');

  return results;
}

measureDecodeConcurrency().catch(console.error);
