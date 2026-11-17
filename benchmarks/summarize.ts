import * as fs from 'node:fs';
import * as path from 'node:path';

console.log('================================================================================');
console.log('📊 AUTHORITATIVE BENCHMARK SUMMARY (Generated via benchmarks/summarize.ts)');
console.log('================================================================================\n');

// 1. Sequence & Frame Count Reconciliation
const indManifestPath = path.resolve('benchmarks/assets/variant-individual/manifest.json');
const indFramesDir = path.resolve('benchmarks/assets/variant-individual/frames');
if (fs.existsSync(indManifestPath) && fs.existsSync(indFramesDir)) {
  const indManifest = JSON.parse(fs.readFileSync(indManifestPath, 'utf8'));
  const files = fs.readdirSync(indFramesDir).filter((f) => f.endsWith('.webp')).sort();
  const sizes = files.map((f) => fs.statSync(path.join(indFramesDir, f)).size);
  const sorted = [...sizes].sort((a, b) => a - b);
  const minKB = (sorted[0] / 1024).toFixed(1);
  const medKB = (sorted[Math.floor(sorted.length / 2)] / 1024).toFixed(1);
  const maxKB = (sorted[sorted.length - 1] / 1024).toFixed(1);

  console.log('### 1. Benchmark Asset Sequence Reconciliation\n');
  console.log('| Sequence Property | Benchmark Suite (`benchmarks/assets/variant-*`) | Showcase Demo (`examples/basic-scroll`) | Format Sweep (`benchmarks/run-format-comparison.ts`) |');
  console.log('| :--- | :--- | :--- | :--- |');
  console.log(`| **Resolution** | \`${indManifest.variants[0].width}x${indManifest.variants[0].height}\` (1080p) | \`1280x720\` (720p) | \`1920x1080\` (1080p Mandelbrot + grain) |`);
  console.log(`| **Frame Count** | **${files.length} frames** (${indManifest.metadata.duration}s @ ${indManifest.metadata.fps} fps) | **90 frames** (3s @ 30 fps) | **15 frames** (0.5s @ 30 fps) |`);
  console.log(`| **Per-Frame Bytes (Min / Median / Max)** | **${minKB} KB / ${medKB} KB / ${maxKB} KB** | 33.5 KB / 34.9 KB / 36.2 KB | Varies by format & quality (see Section 4) |\n`);
}

// 2. Comprehensive Protocol & Variant Matrix
const compPath = path.resolve('benchmarks/results/benchmark-comprehensive-results.json');
if (fs.existsSync(compPath)) {
  const data = JSON.parse(fs.readFileSync(compPath, 'utf8'));

  console.log('### 2. Comprehensive Protocol & Packaging Variant Matrix (300-Frame 1080p Sequence)\n');
  console.log('| Packaging Variant | Protocol | 1st Frame (Unth.) | 1st Frame (Fast 4G) | 1st Frame (Fast 3G 4x) | p95 Render (1x) | p95 Render (4x) | p95 Decode | Long Tasks | Hit Rate (15fps Slow / 30fps Normal) | Missed Frames (30fps) | Avail Latency p95 (30fps) | Mean / Max Frame Error | Manifest Size |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  const variants: Array<'individual' | 'chunked-hero-8' | 'chunked-25' | 'range'> = [
    'individual',
    'chunked-hero-8',
    'chunked-25',
    'range',
  ];
  const protocols: Array<'http1' | 'http2'> = ['http1', 'http2'];

  const manifestSizes: Record<string, string> = {
    individual: `${fs.statSync('benchmarks/assets/variant-individual/manifest.json').size} B`,
    'chunked-hero-8': `${fs.statSync('benchmarks/assets/variant-chunked-hero-8/manifest.json').size} B`,
    'chunked-25': `${fs.statSync('benchmarks/assets/variant-chunked-25/manifest.json').size} B`,
    range: `${fs.statSync('benchmarks/assets/variant-range/manifest.json').size} B`,
  };

  for (const p of protocols) {
    for (const v of variants) {
      const unthFwd = data.find((d: any) => d.protocol === p && d.variant === v && d.networkProfile === 'Unthrottled' && d.scenario === 'forward-scroll');
      const f4gFwd = data.find((d: any) => d.protocol === p && d.variant === v && d.networkProfile === 'Fast 4G' && d.scenario === 'forward-scroll');
      const f3gFwd = data.find((d: any) => d.protocol === p && d.variant === v && d.networkProfile === 'Fast 3G' && d.scenario === 'forward-scroll');
      const slowUnth = data.find((d: any) => d.protocol === p && d.variant === v && d.networkProfile === 'Unthrottled' && d.scenario === 'slow-scrub');

      const t0_unth = unthFwd ? `${unthFwd.timeToFirstFrame.median}ms [${unthFwd.timeToFirstFrame.min}-${unthFwd.timeToFirstFrame.max}]` : '-';
      const t0_4g = f4gFwd ? `${f4gFwd.timeToFirstFrame.median}ms [${f4gFwd.timeToFirstFrame.min}-${f4gFwd.timeToFirstFrame.max}]` : '-';
      const t0_3g = f3gFwd ? `${f3gFwd.timeToFirstFrame.median}ms [${f3gFwd.timeToFirstFrame.min}-${f3gFwd.timeToFirstFrame.max}]` : '-';
      const r_1x = unthFwd ? `${unthFwd.p95RenderTime.median}ms` : '-';
      const r_4x = f3gFwd ? `${f3gFwd.p95RenderTime.median}ms` : '-';
      const d_p95 = unthFwd ? `${unthFwd.p95DecodeTime.median}ms` : '-';
      const lt = unthFwd ? unthFwd.longTaskCount.median : 0;
      const hitFwd = unthFwd ? `${unthFwd.cacheHitRatePct.median}%` : '-';
      const hitSlow = slowUnth ? `${slowUnth.cacheHitRatePct.median}%` : '-';
      const missed = unthFwd ? `${unthFwd.missedFramesCount.median}` : '-';
      const availP95 = unthFwd ? `${unthFwd.availabilityLatencyP95.median}ms` : '-';
      const frameErr = unthFwd ? `${unthFwd.meanFrameError.median} / ${unthFwd.maxFrameError.median}` : '-';
      const mSize = manifestSizes[v];

      console.log(`| **\`${v}\`** | ${p.toUpperCase()} | ${t0_unth} | ${t0_4g} | ${t0_3g} | ${r_1x} | ${r_4x} | ${d_p95} | **${lt}** | ${hitSlow} / ${hitFwd} | ${missed} | ${availP95} | ${frameErr} | ${mSize} |`);
    }
  }
}

// 3. F3 & F4 Hit-Rate & Concurrency Evidence
const f3f4Path = path.resolve('benchmarks/results/f3-f4-hitrate-evidence.json');
if (fs.existsSync(f3f4Path)) {
  const f3f4 = JSON.parse(fs.readFileSync(f3f4Path, 'utf8'));

  console.log('\n### 3. F3 & F4: Hit-Rate & Decode Concurrency Evidence (Unthrottled Localhost, 300-Frame 1080p Sequence)\n');
  console.log('#### 3a. Normal 30 fps Unthrottled Instrumentation (Before vs After)\n');
  console.log('| State | Config | Lookahead Scheduled | Max Queue Depth | Max In-Flight Fetches | Max In-Flight Decodes | Availability Latency (p50 / p95 / p99) | Missed Frames | Hit Rate |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of f3f4.filter((x: any) => x.label.startsWith('F3-'))) {
    console.log(
      `| **${r.label}** | ${r.configDesc} | ${r.lookaheadScheduled} frames | ${r.maxQueueDepth} | ${r.maxInFlightFetches} | ${r.maxInFlightDecodes} | ${r.availabilityLatencyMs.p50} / ${r.availabilityLatencyMs.p95} / ${r.availabilityLatencyMs.p99} ms | ${r.missedFramesCount} / ${r.totalDrawCalls} | **${r.hitRatePct}%** |`
    );
  }

  console.log('\n#### 3b. Hit Rate Across 15, 30, 60, and 375 fps Scenarios (`decodeConcurrency: 1` vs `4`)\n');
  console.log('| Scenario | Decode Concurrency | Hit Rate | Missed Frames | Availability Latency (p50 / p95 / p99) | Displayed Frame Error (mean / p95 / max) | Decode Time (p50 / p95) |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of f3f4.filter((x: any) => x.label.startsWith('F4-'))) {
    console.log(
      `| **\`${r.scenario}\`** | ${r.configDesc} | **${r.hitRatePct}%** | ${r.missedFramesCount} / ${r.totalDrawCalls} | ${r.availabilityLatencyMs.p50} / ${r.availabilityLatencyMs.p95} / ${r.availabilityLatencyMs.p99} ms | ${r.displayedFrameError.mean} / ${r.displayedFrameError.p95} / ${r.displayedFrameError.max} | ${r.decodeTimeMs.p50} / ${r.decodeTimeMs.p95} ms |`
    );
  }
}

// 4. F1 Matched-Quality Format Comparison
const fmtPath = path.resolve('benchmarks/results/format-comparison.json');
if (fs.existsSync(fmtPath)) {
  const fmtData = JSON.parse(fs.readFileSync(fmtPath, 'utf8'));
  console.log('\n### 4. F1: Matched-Quality Format Comparison (WebP vs AVIF vs JPEG @ SSIM Targets 0.95 / 0.98 / 0.99)\n');
  console.log('| Target SSIM | Format | Encoder & Quality | Measured SSIM | Measured PSNR (dB) | Median Bytes / Frame | Total 15f Size | Encode ms / Frame | Decode 1x (p50 / p95) | Decode 4x CPU (p50 / p95) |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const [targetStr, entries] of Object.entries(fmtData.matchedTargets as Record<string, any[]>)) {
    for (const e of entries) {
      const encLabel =
        e.format === 'avif'
          ? `Sharp AVIF Q=${e.qualitySetting} (effort=4)`
          : e.format === 'webp'
          ? `FFmpeg libwebp Q=${e.qualitySetting}`
          : `Sharp JPEG Q=${e.qualitySetting}`;
      console.log(
        `| **${Number(targetStr).toFixed(2)}** | **${e.format.toUpperCase()}** | ${encLabel} | **${e.actualSsim.toFixed(4)}** | ${e.psnrAvgDb.toFixed(2)} dB | **${(e.medianBytesPerFrame / 1024).toFixed(1)} KB** | ${(e.totalBytes / 1024).toFixed(1)} KB | ${e.encodeTimePerFrameMs.toFixed(1)} ms | ${e.decode1x.p50Ms} / ${e.decode1x.p95Ms} ms | ${e.decode4x.p50Ms} / ${e.decode4x.p95Ms} ms |`
      );
    }
  }
}

// 5. Phase 3 Cumulative Progression
const p3Path = path.resolve('benchmarks/results/phase3-progression.json');
if (fs.existsSync(p3Path)) {
  const p3 = JSON.parse(fs.readFileSync(p3Path, 'utf8'));
  console.log('\n### 5. Phase 3 Performance Engineering Progression (`benchmarks/results/phase3-progression.json`)\n');
  console.log(
    `**Environment:** ${p3.environment.browser} | ${p3.environment.os} | ${p3.environment.cpuModel} (${p3.environment.cpuCores} threads) | Asset SHA-256: \`${p3.environment.assetSha256}\` | Commit: \`${p3.environment.engineCommit}\`\n`
  );
  console.log('| Step ID | Optimization | Status | Scenario & Profile | Hit Rate | Missed Frames | Avail Latency (p50 / p95) | Displayed Frame Error (mean / p95 / max) | Decode (p50 / p95) | Render p95 | Cancelled Reqs | Long Tasks | Cache MB | DPR |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const s of p3.progressionSteps) {
    const status = s.kept ? '✅ KEPT' : '↩️ REVERTED';
    console.log(
      `| **\`${s.stepId}\`** | ${s.name} | ${status} | \`${s.scenario}\` (${s.throttleProfile}) | **${s.hitRatePct}%** | ${s.missedFramesCount}/${s.totalDrawCalls} | ${s.availabilityLatencyMs.p50} / ${s.availabilityLatencyMs.p95} ms | **${s.displayedFrameError.mean} / ${s.displayedFrameError.p95} / ${s.displayedFrameError.max}** | ${s.decodeTimeMs.p50} / ${s.decodeTimeMs.p95} ms | ${s.renderTimeMs.p95} ms | ${s.cancelledRequestsCount} | ${s.longTaskCount} | ${s.cacheMb} MB | ${s.currentDpr} |`
    );
  }
}
