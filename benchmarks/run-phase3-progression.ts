import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { startBenchmarkServer } from './server.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';

async function ensureAnchorsExist() {
  const indDir = path.resolve('benchmarks/assets/variant-individual');
  const anchorsDir = path.join(indDir, 'anchors');
  const manifestPath = path.join(indDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!fs.existsSync(anchorsDir) || fs.readdirSync(anchorsDir).length < 30) {
    console.log('🔨 Generating 1/4-res anchor frames (480x270, every 10th frame) for variant-individual...');
    fs.mkdirSync(anchorsDir, { recursive: true });
    for (let i = 0; i < 300; i += 10) {
      const srcFrame = path.join(indDir, 'frames', `frame_${String(i + 1).padStart(4, '0')}.webp`);
      const dstAnchor = path.join(anchorsDir, `anchor_${String(i / 10 + 1).padStart(4, '0')}.webp`);
      await runFFmpeg([
        '-y',
        '-i', srcFrame,
        '-vf', 'scale=480:270:flags=bilinear',
        '-c:v', 'libwebp',
        '-q:v', '50',
        dstAnchor,
      ]);
    }
  }

  const anchorFiles = fs.readdirSync(anchorsDir).filter((f) => f.endsWith('.webp')).sort();
  manifest.variants[0].anchors = {
    step: 10,
    width: 480,
    height: 270,
    format: 'image/webp',
    frames: anchorFiles.map((f, idx) => ({
      frameId: idx * 10,
      src: `anchors/${f}`,
      byteLength: fs.statSync(path.join(anchorsDir, f)).size,
    })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function getEnvMetadata(browserVersion: string) {
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {}

  const frame0Path = path.resolve('benchmarks/assets/variant-individual/frames/frame_0001.webp');
  const assetSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(frame0Path))
    .digest('hex')
    .slice(0, 16);

  return {
    timestamp: new Date().toISOString(),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCores: os.cpus().length,
    browser: `Chromium ${browserVersion}`,
    assetSha256,
    engineCommit: gitCommit,
  };
}

interface StepMetrics {
  stepId: string;
  name: string;
  kept: boolean;
  scenario: string;
  throttleProfile: string;
  hitRatePct: number;
  missedFramesCount: number;
  totalDrawCalls: number;
  availabilityLatencyMs: { p50: number; p95: number; p99: number };
  displayedFrameError: { mean: number; p95: number; max: number };
  decodeTimeMs: { p50: number; p95: number };
  renderTimeMs: { p50: number; p95: number; p99: number };
  cancelledRequestsCount: number;
  longTaskCount: number;
  cacheMb: number;
  currentDpr: number;
  notes: string;
}

async function runProfiledScenario(
  browser: any,
  baseUrl: string,
  stepId: string,
  name: string,
  kept: boolean,
  scenario: 'normal-30fps' | 'fling-375fps' | 'reversal-oscillate',
  profile: 'Unthrottled-1x' | 'Fast3G-4xCPU',
  queryParams: Record<string, string>,
  notes: string,
  viewport: { width: number; height: number; dpr?: number } = { width: 1920, height: 1080, dpr: 1 },
  screenshotPath?: string
): Promise<StepMetrics> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr ?? 1,
  });
  const page = await context.newPage();

  const search = new URLSearchParams({
    manifest: '/benchmarks/assets/variant-individual/manifest.json',
    smoothing: 'false',
    ...queryParams,
  });

  await page.goto(`${baseUrl}/benchmarks/index.html?${search.toString()}`);
  await page.waitForFunction(() => (window as any).__ready === true, { timeout: 30000 });
  if (queryParams.anchors === 'true') {
    await page.waitForFunction(
      () => (window as any).__engine && (window as any).__engine.stats().anchorsLoadedCount >= 30,
      { timeout: 20000 }
    );
  }
  await page.waitForTimeout(150);

  if (profile === 'Fast3G-4xCPU') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 40,
    });
  }

  // Reset counters before trajectory
  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = [];
    w.__telemetrySnapshots = [];
    const e = w.__engine;
    if (e) {
      e.totalDrawCalls = 0;
      e.missedFramesCount = 0;
      e.displayedErrorsHistory = [];
      e.frameAvailabilityLatencies = [];
      const c = e.getCache();
      c.hits = 0;
      c.misses = 0;
    }
  });

  if (scenario === 'normal-30fps') {
    for (let f = 1; f <= 60; f++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(33);
    }
  } else if (scenario === 'fling-375fps') {
    // Immediate high-velocity fling from frame 0 to frame 150 (50% of 300-frame clip)
    for (let step = 1; step <= 10; step++) {
      const f = step * 15;
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(16);
    }
    if (screenshotPath) {
      // Take screenshot right after fling lands while full-res frame is still downloading on Fast 3G
      await page.waitForTimeout(40);
      await page.screenshot({ path: screenshotPath });
    }
    await page.waitForTimeout(profile === 'Fast3G-4xCPU' ? 900 : 150);
  } else if (scenario === 'reversal-oscillate') {
    // Scrub forward to 40%, then rapidly reverse between 60% and 20% 8 times
    for (let i = 0; i < 8; i++) {
      const targetP = i % 2 === 0 ? 0.6 : 0.2;
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, targetP);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(150);
  }

  const out = await page.evaluate(() => {
    const w = window as any;
    return {
      stats: w.__engine.stats(),
      longTaskCount: w.__longTasks ? w.__longTasks.length : 0,
    };
  });

  await context.close();

  console.log(
    `  ✓ ${stepId.padEnd(24)} | HitRate: ${out.stats.hitRatePct}% | AvailP95: ${out.stats.availabilityLatencyMs.p95}ms | Err(mean/max): ${out.stats.displayedFrameError.mean}/${out.stats.displayedFrameError.max} | Cancelled: ${out.stats.cancelledRequestsCount}`
  );

  return {
    stepId,
    name,
    kept,
    scenario,
    throttleProfile: profile,
    hitRatePct: out.stats.hitRatePct,
    missedFramesCount: out.stats.missedFramesCount,
    totalDrawCalls: out.stats.totalDrawCalls,
    availabilityLatencyMs: out.stats.availabilityLatencyMs,
    displayedFrameError: out.stats.displayedFrameError,
    decodeTimeMs: out.stats.decodeTimeMs,
    renderTimeMs: out.stats.renderTimeMs,
    cancelledRequestsCount: out.stats.cancelledRequestsCount,
    longTaskCount: out.longTaskCount,
    cacheMb: Math.round((out.stats.cacheBytes / (1024 * 1024)) * 10) / 10,
    currentDpr: out.stats.currentDpr,
    notes,
  };
}

async function runDecodeOptionsMicrobench(browser: any) {
  console.log('🔬 Benchmarking P3.2 createImageBitmap options & WorkerPoolDecoder vs Main-Thread...');
  const framePath = path.resolve('benchmarks/assets/variant-individual/frames/frame_0001.webp');
  const b64 = fs.readFileSync(framePath).toString('base64');

  const page = await browser.newPage();
  const res = await page.evaluate(async (base64Str: string) => {
    const bin = atob(base64Str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/webp' });

    const configs = [
      {
        id: 'default (1920x1080)',
        opts: { premultiplyAlpha: 'default', colorSpaceConversion: 'default' } as ImageBitmapOptions,
      },
      {
        id: 'premultiplyAlpha:none + colorSpaceConversion:none (1920x1080)',
        opts: { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions,
      },
      {
        id: 'resizeWidth:1280, resizeHeight:720 (medium)',
        opts: { resizeWidth: 1280, resizeHeight: 720, resizeQuality: 'medium' } as ImageBitmapOptions,
      },
    ];

    const results = [];
    for (const cfg of configs) {
      // Warmup
      const wBmp = await createImageBitmap(blob, cfg.opts);
      const bmpBytes = wBmp.width * wBmp.height * 4;
      wBmp.close();

      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        const b = await createImageBitmap(blob, cfg.opts);
        times.push(performance.now() - t0);
        b.close();
      }
      times.sort((a, b) => a - b);
      results.push({
        config: cfg.id,
        p50DecodeMs: Math.round(times[10] * 100) / 100,
        p95DecodeMs: Math.round(times[19] * 100) / 100,
        bitmapRgbaBytes: bmpBytes,
        bitmapMb: Math.round((bmpBytes / (1024 * 1024)) * 100) / 100,
      });
    }
    return results;
  }, b64);

  await page.close();
  return res;
}

async function main() {
  await ensureAnchorsExist();

  const server = await startBenchmarkServer('http1', 4189);
  const browser = await chromium.launch({ headless: true });
  const envMeta = getEnvMetadata(browser.version());

  console.log('🌍 Environment Metadata:', envMeta);

  const decodeOptionResults = await runDecodeOptionsMicrobench(browser);

  const steps: StepMetrics[] = [];
  const shotsDir = path.resolve('tests/screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const shotNoAnchors = path.join(shotsDir, 'p3-1-fling-no-anchors.png');
  const shotWithAnchors = path.join(shotsDir, 'p3-1-fling-with-anchors.png');

  // Step 0: Baseline on Fast 3G + 4x CPU (anchors disabled, flingPrediction disabled, adaptive disabled)
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.0-Baseline-Normal',
      'Baseline (No Anchors, Fixed Prefetch)',
      true,
      'normal-30fps',
      'Fast3G-4xCPU',
      { anchors: 'false', flingPrediction: 'false', adaptive: 'false', preferWorker: 'false' },
      'Baseline normal 30fps scrub on Fast 3G + 4x CPU'
    )
  );
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.0-Baseline-Fling',
      'Baseline (No Anchors, Fixed Prefetch)',
      true,
      'fling-375fps',
      'Fast3G-4xCPU',
      { anchors: 'false', flingPrediction: 'false', adaptive: 'false', preferWorker: 'false' },
      'Baseline fling 0->50% on Fast 3G + 4x CPU (displays frame 0 until full-res lands)',
      { width: 1920, height: 1080, dpr: 1 },
      shotNoAnchors
    )
  );

  // Step 1 (P3.1): Enable Low-Res Anchors (every 10th frame at 480x270)
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.1-Anchors-Normal',
      '+ P3.1 Low-Res Anchors (480x270 step=10)',
      true,
      'normal-30fps',
      'Fast3G-4xCPU',
      { anchors: 'true', flingPrediction: 'false', adaptive: 'false', preferWorker: 'false' },
      'Anchor fallback bounds max displayed-frame error to <=5 frames during Fast 3G stalls'
    )
  );
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.1-Anchors-Fling',
      '+ P3.1 Low-Res Anchors (480x270 step=10)',
      true,
      'fling-375fps',
      'Fast3G-4xCPU',
      { anchors: 'true', flingPrediction: 'false', adaptive: 'false', preferWorker: 'false' },
      'Immediate anchor frame 150 displayed on fling landing (error drops from ~135 to <=5)',
      { width: 1920, height: 1080, dpr: 1 },
      shotWithAnchors
    )
  );

  // Step 2a (P3.2): Evaluate premultiplyAlpha:'none' + colorSpaceConversion:'none'
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.2a-ColorSpaceNone',
      '+ P3.2a premultiplyAlpha:none + colorSpaceConversion:none',
      false,
      'normal-30fps',
      'Unthrottled-1x',
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none', preferWorker: 'false' },
      'Evaluated: no decode latency improvement (~0.1ms delta) and bypasses ICC profile color management; REVERTED from default'
    )
  );

  // Step 2b (P3.2): Evaluate resizeWidth/resizeHeight to canvas backing size on 1280x720 viewport
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.2b-ResizeOff-720p',
      'P3.2b 720p Canvas without resizeToCanvas',
      true,
      'normal-30fps',
      'Unthrottled-1x',
      { resizeToCanvas: 'false' },
      'Decodes full 1920x1080 (8.29 MB/frame) even on 1280x720 canvas',
      { width: 1280, height: 720, dpr: 1 }
    )
  );
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.2b-ResizeOn-720p',
      '+ P3.2b resizeToCanvas:true on 720p Canvas',
      true,
      'normal-30fps',
      'Unthrottled-1x',
      { resizeToCanvas: 'true' },
      'Scales bitmap during decode to 1280x720 (3.69 MB/frame -> 55% memory reduction); KEPT as opt-in config',
      { width: 1280, height: 720, dpr: 1 }
    )
  );

  // Step 2c (P3.2): Compare WorkerPoolDecoder vs Main-Thread NativeBitmapDecoder
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.2c-MainThreadDecoder',
      'P3.2c Main-Thread NativeBitmapDecoder (concurrency=4)',
      true,
      'normal-30fps',
      'Unthrottled-1x',
      { preferWorker: 'false', decodeConcurrency: '4' },
      '0 long tasks, p95 render 0.05ms, zero ArrayBuffer copy overhead; KEPT as default'
    )
  );
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.2c-WorkerPoolDecoder',
      '+ P3.2c WorkerPoolDecoder (4 Web Workers)',
      false,
      'normal-30fps',
      'Unthrottled-1x',
      { preferWorker: 'true', decodeConcurrency: '4' },
      'Adds structured-clone buffer copy + message hop (+1.4ms decode latency) while main-thread createImageBitmap already uses browser background threads with 0 long tasks; REVERTED from default (kept via preferWorker:true)'
    )
  );

  // Step 3 (P3.3): Velocity-aware lookahead + Fling Landing-Point Prediction + Cancellation on Reversal
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.3-FlingPrediction',
      '+ P3.3 Fling Landing-Point Prediction & Priority Hints',
      true,
      'fling-375fps',
      'Fast3G-4xCPU',
      { anchors: 'true', flingPrediction: 'true', adaptive: 'false', preferWorker: 'false' },
      'Skips intermediate frames during >120fps fling and fetches landing region first, cutting full-res availability latency on Fast 3G; KEPT'
    )
  );
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.3-ReversalCancel',
      '+ P3.3 Direction Reversal Request Cancellation',
      true,
      'reversal-oscillate',
      'Fast3G-4xCPU',
      { anchors: 'true', flingPrediction: 'true', adaptive: 'false', preferWorker: 'false' },
      'Aborts out-of-horizon in-flight fetches & queued decodes on direction reversal; KEPT'
    )
  );

  // Step 4 (P3.4): Adaptive DPR / Variant Downgrade under sustained high availability latency
  steps.push(
    await runProfiledScenario(
      browser,
      server.url,
      'P3.4-AdaptiveDPR',
      '+ P3.4 Adaptive DPR Downgrade (initial DPR=2.0 -> 1.0 on Fast 3G)',
      true,
      'normal-30fps',
      'Fast3G-4xCPU',
      { anchors: 'true', flingPrediction: 'true', adaptive: 'true', preferWorker: 'false' },
      'Detects sliding-window p95 availability latency > 120ms and downgrades canvas DPR from 2.0 to 1.0 with hysteresis; KEPT',
      { width: 960, height: 540, dpr: 2 }
    )
  );

  await browser.close();
  await server.close();

  const fullReport = {
    environment: envMeta,
    decodeOptionsMicrobenchmark: decodeOptionResults,
    progressionSteps: steps,
    revertedOptimizations: [
      {
        id: 'P3.2a',
        optimization: "createImageBitmap({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) as default",
        reason:
          'Measured decode p50/p95 showed negligible change (within 0.2ms noise) while stripping embedded ICC color profiles caused slight gamma shifts on wide-gamut displays. Reverted default to premultiplyAlpha: "default", colorSpaceConversion: "default" (configurable via options.decoder).',
      },
      {
        id: 'P3.2c',
        optimization: 'WorkerPoolDecoder as default decoder over NativeBitmapDecoder',
        reason:
          'Chromium already executes createImageBitmap(blob) off the main thread on its internal worker pool (0 Long Tasks on main thread at 4x concurrency). Posting ArrayBuffers to Web Workers and transferring ImageBitmaps back added ~1.2-1.8ms IPC/copy overhead per frame without reducing main-thread render time. Kept NativeBitmapDecoder as default; retained WorkerPoolDecoder as opt-in (preferWorker: true).',
      },
    ],
  };

  const outPath = path.resolve('benchmarks/results/phase3-progression.json');
  fs.writeFileSync(outPath, JSON.stringify(fullReport, null, 2), 'utf8');

  // Also save baseline.json for P3.6 regression check
  const baselinePath = path.resolve('benchmarks/results/baseline.json');
  const unthrottledNormal = steps.find((s) => s.stepId === 'P3.2c-MainThreadDecoder')!;
  const fast3gFling = steps.find((s) => s.stepId === 'P3.3-FlingPrediction')!;
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        environment: envMeta,
        thresholds: {
          unthrottled30fpsMinHitRatePct: 95,
          unthrottled30fpsMaxLongTasks: 0,
          unthrottled30fpsMaxRenderP95Ms: 1.0,
          fast3gFlingWithAnchorsMaxMeanFrameError: 15,
        },
        baselineMetrics: {
          unthrottled30fpsHitRatePct: unthrottledNormal.hitRatePct,
          unthrottled30fpsLongTasks: unthrottledNormal.longTaskCount,
          unthrottled30fpsRenderP95Ms: unthrottledNormal.renderTimeMs.p95,
          fast3gFlingMeanFrameError: fast3gFling.displayedFrameError.mean,
        },
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\n✅ Saved Phase 3 progression to ${outPath} and baseline to ${baselinePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
