import { chromium } from '@playwright/test';
import { startBenchmarkServer } from './server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface ScenarioPerfResult {
  label: string;
  scenario: '15fps-slow' | '30fps-normal' | '60fps-fast' | '375fps-fling';
  configDesc: string;
  hitRatePct: number;
  missedFramesCount: number;
  totalDrawCalls: number;
  lookaheadScheduled: number;
  maxQueueDepth: number;
  maxInFlightFetches: number;
  maxInFlightDecodes: number;
  availabilityLatencyMs: { p50: number; p95: number; p99: number };
  displayedFrameError: { mean: number; p95: number; max: number };
  decodeTimeMs: { p50: number; p95: number };
  renderTimeMs: { p50: number; p95: number; p99: number };
}

async function runSingleScenario(
  browser: any,
  baseUrl: string,
  scenario: '15fps-slow' | '30fps-normal' | '60fps-fast' | '375fps-fling',
  queryParams: Record<string, string>,
  label: string,
  configDesc: string,
  cpuThrottleRate: number = 1
): Promise<ScenarioPerfResult> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  if (cpuThrottleRate > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
  }

  const search = new URLSearchParams({
    manifest: '/benchmarks/assets/variant-individual/manifest.json',
    smoothing: 'false',
    ...queryParams,
  });

  await page.goto(`${baseUrl}/benchmarks/index.html?${search.toString()}`);
  await page.waitForFunction(() => (window as any).__ready === true, { timeout: 20000 });
  // Allow initial lookahead after frame 0 to warm up for 150ms
  await page.waitForTimeout(150);

  // Reset telemetry counters right before timed trajectory so we measure pure scrub behavior
  await page.evaluate(() => {
    const w = window as any;
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

  // Execute trajectory over the 300-frame sequence:
  // 15 fps slow-scrub: advance 1 frame every 66ms for 45 frames (3.0s) -> p from 0 to 45/299
  // 30 fps normal-scrub: advance 1 frame every 33ms for 90 frames (3.0s) -> p from 0 to 90/299
  // 60 fps fast-scrub: advance 1 frame every 16ms for 90 frames (1.5s) -> p from 0 to 90/299
  // 375 fps fling: jump across 90 frames in 240ms (15 steps of 6 frames every 16ms)
  if (scenario === '15fps-slow') {
    for (let f = 1; f <= 45; f++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(66);
    }
  } else if (scenario === '30fps-normal') {
    for (let f = 1; f <= 90; f++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(33);
    }
  } else if (scenario === '60fps-fast') {
    for (let f = 1; f <= 90; f++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(16);
    }
  } else if (scenario === '375fps-fling') {
    for (let step = 1; step <= 15; step++) {
      const f = step * 6;
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, f / 299);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
  }

  await page.waitForTimeout(100);

  const collected = await page.evaluate(() => {
    const w = window as any;
    const stats = w.__engine.stats();
    const snaps = w.__telemetrySnapshots || [];
    let maxLookahead = stats.lookaheadScheduled;
    let maxQueue = 0;
    let maxFetches = 0;
    let maxDecodes = 0;
    for (const s of snaps) {
      if (s.lookaheadScheduled > maxLookahead) maxLookahead = s.lookaheadScheduled;
      if (s.queueDepth > maxQueue) maxQueue = s.queueDepth;
      if (s.inFlightRequests > maxFetches) maxFetches = s.inFlightRequests;
      if (s.inFlightDecodes > maxDecodes) maxDecodes = s.inFlightDecodes;
    }
    return {
      stats,
      maxLookahead,
      maxQueue,
      maxFetches,
      maxDecodes,
    };
  });

  await context.close();

  return {
    label,
    scenario,
    configDesc,
    hitRatePct: collected.stats.hitRatePct,
    missedFramesCount: collected.stats.missedFramesCount,
    totalDrawCalls: collected.stats.totalDrawCalls,
    lookaheadScheduled: collected.maxLookahead,
    maxQueueDepth: collected.maxQueue,
    maxInFlightFetches: collected.maxFetches,
    maxInFlightDecodes: collected.maxDecodes,
    availabilityLatencyMs: collected.stats.availabilityLatencyMs,
    displayedFrameError: collected.stats.displayedFrameError,
    decodeTimeMs: collected.stats.decodeTimeMs,
    renderTimeMs: collected.stats.renderTimeMs,
  };
}

async function main() {
  console.log('🔬 Measuring F3 & F4 Hit-Rate & Decode Concurrency Evidence...');
  const server = await startBenchmarkServer('http1', 4188);
  const browser = await chromium.launch({ headless: true });

  const results: ScenarioPerfResult[] = [];

  // 1. F3: Normal 30 fps Unthrottled BEFORE (pre-fix: fixed lookahead=12, velocityAware=false, eagerPrefetchDecode=false, decodeConcurrency=1) vs AFTER (velocityAware=true, eagerPrefetchDecode=true, lookahead=24->48, decodeConcurrency=4)
  results.push(
    await runSingleScenario(
      browser,
      server.url,
      '30fps-normal',
      { lookahead: '12', velocityAware: 'false', eagerPrefetchDecode: 'false', fetchConcurrency: '4', decodeConcurrency: '1' },
      'F3-Before',
      'Pre-fix (fixed lookahead=12, velocityAware=false, eagerPrefetchDecode=false, decodeConcurrency=1)'
    )
  );

  results.push(
    await runSingleScenario(
      browser,
      server.url,
      '30fps-normal',
      { lookahead: '24', velocityAware: 'true', eagerPrefetchDecode: 'true', fetchConcurrency: '6', decodeConcurrency: '4' },
      'F3-After',
      'Post-fix (velocity-aware lookahead 24->48, eagerPrefetchDecode=true, decodeConcurrency=4)'
    )
  );

  // 2. F3 & F4: Full scenario table (15, 30, 60, 375 fps) comparing decodeConcurrency=1 vs decodeConcurrency=4 (under realistic 4x CPU throttle for 60fps & 375fps fling to expose decode concurrency limits, and 1x unthrottled)
  const scenarios: Array<'15fps-slow' | '30fps-normal' | '60fps-fast' | '375fps-fling'> = [
    '15fps-slow',
    '30fps-normal',
    '60fps-fast',
    '375fps-fling',
  ];

  for (const sc of scenarios) {
    const cpuRate = sc === '60fps-fast' || sc === '375fps-fling' ? 4 : 1;
    const cpuLabel = cpuRate > 1 ? ` (${cpuRate}x CPU)` : ' (1x CPU)';
    results.push(
      await runSingleScenario(
        browser,
        server.url,
        sc,
        { lookahead: '24', velocityAware: 'true', fetchConcurrency: '6', decodeConcurrency: '1', flingPrediction: 'false' },
        `F4-Conc1-${sc}`,
        `decodeConcurrency=1${cpuLabel}`,
        cpuRate
      )
    );
    results.push(
      await runSingleScenario(
        browser,
        server.url,
        sc,
        { lookahead: '24', velocityAware: 'true', fetchConcurrency: '6', decodeConcurrency: '4', flingPrediction: 'false' },
        `F4-Conc4-${sc}`,
        `decodeConcurrency=4${cpuLabel}`,
        cpuRate
      )
    );
  }

  await browser.close();
  await server.close();

  const outPath = path.resolve('benchmarks/results/f3-f4-hitrate-evidence.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSaved F3/F4 evidence to ${outPath}\n`);

  console.log('### F3: Normal 30 fps Unthrottled Instrumentation (Before vs After)\n');
  console.log('| State | Config | Lookahead Scheduled | Max Queue Depth | Max In-Flight Fetches | Max In-Flight Decodes | Availability Latency (p50 / p95 / p99) | Missed Frames | Hit Rate |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of results.filter((x) => x.label.startsWith('F3-'))) {
    console.log(
      `| **${r.label}** | ${r.configDesc} | ${r.lookaheadScheduled} frames | ${r.maxQueueDepth} | ${r.maxInFlightFetches} | ${r.maxInFlightDecodes} | ${r.availabilityLatencyMs.p50} / ${r.availabilityLatencyMs.p95} / ${r.availabilityLatencyMs.p99} ms | ${r.missedFramesCount} / ${r.totalDrawCalls} | **${r.hitRatePct}%** |`
    );
  }

  console.log('\n### F3 & F4: Hit Rate & Latency Across 15, 30, 60, and 375 fps Scenarios (`decodeConcurrency: 1` vs `4`)\n');
  console.log('| Scenario | Decode Concurrency | Hit Rate | Missed Frames | Availability Latency (p50 / p95 / p99) | Displayed Frame Error (mean / p95 / max) | Decode Time (p50 / p95) |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of results.filter((x) => x.label.startsWith('F4-'))) {
    console.log(
      `| **\`${r.scenario}\`** | ${r.configDesc} | **${r.hitRatePct}%** | ${r.missedFramesCount} / ${r.totalDrawCalls} | ${r.availabilityLatencyMs.p50} / ${r.availabilityLatencyMs.p95} / ${r.availabilityLatencyMs.p99} ms | ${r.displayedFrameError.mean} / ${r.displayedFrameError.p95} / ${r.displayedFrameError.max} | ${r.decodeTimeMs.p50} / ${r.decodeTimeMs.p95} ms |`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
