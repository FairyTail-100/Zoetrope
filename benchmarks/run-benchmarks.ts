import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, CDPSession } from '@playwright/test';
import { startBenchmarkServer, BenchmarkServer } from './server.js';

interface SingleRunSample {
  timeToFirstFrameMs: number;
  sampleCount: number;
  p50RenderTimeMs: number;
  p95RenderTimeMs: number;
  p99RenderTimeMs: number;
  p50DecodeTimeMs: number;
  p95DecodeTimeMs: number;
  p50FetchTimeMs: number;
  p95FetchTimeMs: number;
  cacheHitRatePct: number;
  missedFramesCount: number;
  p50AvailabilityLatencyMs: number;
  p95AvailabilityLatencyMs: number;
  meanFrameError: number;
  maxFrameError: number;
  peakCacheMemoryMb: number;
  steadyCacheMemoryMb: number;
  peakJSHeapMb: number;
  longTaskCount: number;
  bytesTransferredKb: number;
}

interface BenchmarkAggregatedResult {
  variant: 'individual' | 'chunked-25' | 'chunked-hero-8' | 'range';
  protocol: 'http1' | 'http2';
  networkProfile: 'Unthrottled' | 'Fast 4G' | 'Fast 3G';
  cpuThrottle: '1x' | '4x';
  scenario: string;
  runsCount: number;
  timeToFirstFrame: { median: number; min: number; max: number };
  sampleCount: { median: number; min: number; max: number; flagLowSamples: boolean };
  p50RenderTime: { median: number; min: number; max: number };
  p95RenderTime: { median: number; min: number; max: number };
  p50DecodeTime: { median: number; min: number; max: number };
  p95DecodeTime: { median: number; min: number; max: number };
  p50FetchTime: { median: number; min: number; max: number };
  p95FetchTime: { median: number; min: number; max: number };
  cacheHitRatePct: { median: number; min: number; max: number };
  missedFramesCount: { median: number; min: number; max: number };
  availabilityLatencyP95: { median: number; min: number; max: number };
  meanFrameError: { median: number; min: number; max: number };
  maxFrameError: { median: number; min: number; max: number };
  peakCacheMemoryMb: { median: number; min: number; max: number };
  peakJSHeapMb: { median: number; min: number; max: number };
  longTaskCount: { median: number; min: number; max: number };
  bytesTransferredKb: { median: number; min: number; max: number };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 100) / 100;
}

function medianAndRange(arr: number[]): { median: number; min: number; max: number } {
  if (arr.length === 0) return { median: 0, min: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    median: Math.round(med * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

const NETWORK_PROFILES = {
  Unthrottled: null,
  'Fast 4G': {
    offline: false,
    downloadThroughput: (9.0 * 1024 * 1024) / 8, // 9 Mbps
    uploadThroughput: (750 * 1024) / 8,          // 750 kbps
    latency: 40,                                 // 40ms
  },
  'Fast 3G': {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps
    uploadThroughput: (750 * 1024) / 8,          // 750 kbps
    latency: 40,                                 // 40ms
  },
};

async function executeScenario(page: any, scenario: string, throttled: boolean) {
  const stepDelay = throttled ? 15 : 8;

  if (scenario === 'forward-scroll') {
    // 0% to 100% smoothly across 100 steps (guarantees >= 100 samples)
    const steps = 100;
    for (let s = 1; s <= steps; s++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, s / steps);
      await page.waitForTimeout(stepDelay);
    }
  } else if (scenario === 'reverse-scroll') {
    // Jump to 100% first, then scrub backward to 0% in 100 steps
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max, behavior: 'auto' });
    });
    await page.waitForTimeout(100);

    const steps = 100;
    for (let s = steps - 1; s >= 0; s--) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, s / steps);
      await page.waitForTimeout(stepDelay);
    }
  } else if (scenario === 'rapid-direction-changes') {
    // Rapidly oscillate between 40% and 60% 12 times
    for (let i = 0; i < 12; i++) {
      const pos = i % 2 === 0 ? 0.6 : 0.4;
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, pos);
      await page.waitForTimeout(throttled ? 40 : 20);
    }
  } else if (scenario === 'high-velocity-fling') {
    // Immediate fling from 0% to 100% in 1 frame
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max, behavior: 'auto' });
    });
    await page.waitForTimeout(throttled ? 300 : 100);
  } else if (scenario === 'slow-scrub') {
    // Slow fine scrub: 0% to 10% in 100 fine steps
    const steps = 100;
    for (let s = 1; s <= steps; s++) {
      await page.evaluate((p: number) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: 'auto' });
      }, s * 0.001);
      await page.waitForTimeout(throttled ? 15 : 8);
    }
  }

  // Allow last frame to settle
  await page.waitForTimeout(100);
}

export async function runFullBenchmarkSuite() {
  console.log('🏁 Starting Fair Ascenta-Class Animation Pipeline Benchmarks...');
  const resultsDir = path.resolve('benchmarks/results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags="--expose-gc"', '--ignore-certificate-errors'],
  });

  const variants: Array<'individual' | 'chunked-25' | 'chunked-hero-8' | 'range'> = [
    'individual',
    'chunked-25',
    'chunked-hero-8',
    'range',
  ];

  const protocols: Array<'http1' | 'http2'> = ['http1', 'http2'];
  const testMatrix = [
    { network: 'Unthrottled' as const, cpu: '1x' as const },
    { network: 'Fast 4G' as const, cpu: '1x' as const },
    { network: 'Fast 3G' as const, cpu: '4x' as const },
  ];

  const scenarios = [
    'forward-scroll',
    'reverse-scroll',
    'rapid-direction-changes',
    'high-velocity-fling',
    'slow-scrub',
  ];

  const outJson = path.join(resultsDir, 'benchmark-comprehensive-results.json');
  let aggregatedResults: BenchmarkAggregatedResult[] = [];
  if (fs.existsSync(outJson)) {
    try {
      aggregatedResults = JSON.parse(fs.readFileSync(outJson, 'utf-8'));
      console.log(`📂 Loaded ${aggregatedResults.length} previously recorded benchmark scenarios from JSON.`);
    } catch {}
  }

  const REPEAT_COUNT = 5;

  for (const protocol of protocols) {
    const port = protocol === 'http1' ? 4181 : 4182;
    console.log(`\n======================================================`);
    console.log(`🌐 Starting Server: ${protocol.toUpperCase()} on port ${port}`);
    console.log(`======================================================`);

    const server: BenchmarkServer = await startBenchmarkServer(protocol, port);

    for (const variant of variants) {
      console.log(`\n📦 Packaging Variant: ${variant.toUpperCase()}`);

      for (const config of testMatrix) {
        console.log(`  ⚡ Profile: ${config.network} | CPU: ${config.cpu}`);

        for (const scenario of scenarios) {
          const alreadyRecorded = aggregatedResults.some(
            (r) =>
              r.protocol === protocol &&
              r.variant === variant &&
              r.networkProfile === config.network &&
              r.cpuThrottle === config.cpu &&
              r.scenario === scenario
          );

          if (alreadyRecorded) {
            console.log(`    ▶ Scenario: ${scenario.padEnd(24)} (Already recorded in JSON, skipping)`);
            continue;
          }

          process.stdout.write(`    ▶ Scenario: ${scenario.padEnd(24)} `);

          const runSamples: SingleRunSample[] = [];

          for (let run = 1; run <= REPEAT_COUNT; run++) {
            const context = await browser.newContext({
              viewport: { width: 1920, height: 1080 },
              ignoreHTTPSErrors: true,
            });

            const page = await context.newPage();
            let cdp: CDPSession | null = null;

            if (config.network !== 'Unthrottled' || config.cpu !== '1x') {
              cdp = await context.newCDPSession(page);
              if (config.cpu === '4x') {
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
              }
              const netCond = NETWORK_PROFILES[config.network];
              if (netCond) {
                await cdp.send('Network.emulateNetworkConditions', netCond);
              }
            }

            const manifestPath = `/benchmarks/assets/variant-${variant}/manifest.json`;
            const harnessUrl = `${server.url}/benchmarks/index.html?manifest=${encodeURIComponent(manifestPath)}&smoothing=false`;

            await page.goto(harnessUrl);
            await page.waitForFunction(() => (window as any).__ready === true, { timeout: 20000 });
            await page.waitForFunction(() => (window as any).__firstFrameTime !== null, { timeout: 15000 });

            // Execute scenario
            await executeScenario(page, scenario, config.cpu === '4x');

            // Gather metrics
            const rawMetrics = await page.evaluate(() => {
              const w = window as any;
              const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
              let totalBytes = 0;
              for (const r of resources) {
                totalBytes += r.transferSize || r.encodedBodySize || 0;
              }

              const mem = (performance as any).memory;
              const peakHeap = mem ? mem.usedJSHeapSize / (1024 * 1024) : 0;
              const latencies = w.__engine ? w.__engine.getAvailabilityLatencies() : [];

              return {
                firstFrameMs: w.__firstFrameTime ?? 0,
                renderTimes: w.__renderTimes || [],
                decodeTimes: w.__decodeTimes || [],
                fetchTimes: w.__fetchTimes || [],
                missedFrames: w.__missedFramesCount || 0,
                frameErrors: w.__displayedFrameErrors || [],
                availabilityLatencies: latencies,
                peakCacheBytes: w.__peakCacheBytes || 0,
                lastCacheBytes: w.__lastCacheBytes || 0,
                hitRate: w.__engine ? Math.round(w.__engine.getCache().getStats().hitRate * 100) : 0,
                peakHeapMb: Math.round(peakHeap * 10) / 10,
                longTasksCount: w.__longTasks ? w.__longTasks.length : 0,
                transferredBytes: totalBytes,
              };
            });

            await context.close();

            const p50Render = percentile(rawMetrics.renderTimes, 50);
            const p95Render = percentile(rawMetrics.renderTimes, 95);
            const p99Render = percentile(rawMetrics.renderTimes, 99);

            const p50Decode = percentile(rawMetrics.decodeTimes, 50);
            const p95Decode = percentile(rawMetrics.decodeTimes, 95);

            const p50Fetch = percentile(rawMetrics.fetchTimes, 50);
            const p95Fetch = percentile(rawMetrics.fetchTimes, 95);

            const p50Avail = percentile(rawMetrics.availabilityLatencies, 50);
            const p95Avail = percentile(rawMetrics.availabilityLatencies, 95);

            const meanErr = rawMetrics.frameErrors.length > 0
              ? Math.round((rawMetrics.frameErrors.reduce((a: number, b: number) => a + b, 0) / rawMetrics.frameErrors.length) * 100) / 100
              : 0;
            const maxErr = rawMetrics.frameErrors.length > 0 ? Math.max(...rawMetrics.frameErrors) : 0;

            runSamples.push({
              timeToFirstFrameMs: Math.round(rawMetrics.firstFrameMs),
              sampleCount: rawMetrics.renderTimes.length,
              p50RenderTimeMs: p50Render,
              p95RenderTimeMs: p95Render,
              p99RenderTimeMs: p99Render,
              p50DecodeTimeMs: p50Decode,
              p95DecodeTimeMs: p95Decode,
              p50FetchTimeMs: p50Fetch,
              p95FetchTimeMs: p95Fetch,
              cacheHitRatePct: rawMetrics.hitRate,
              missedFramesCount: rawMetrics.missedFrames,
              p50AvailabilityLatencyMs: p50Avail,
              p95AvailabilityLatencyMs: p95Avail,
              meanFrameError: meanErr,
              maxFrameError: maxErr,
              peakCacheMemoryMb: Math.round((rawMetrics.peakCacheBytes / (1024 * 1024)) * 10) / 10,
              steadyCacheMemoryMb: Math.round((rawMetrics.lastCacheBytes / (1024 * 1024)) * 10) / 10,
              peakJSHeapMb: rawMetrics.peakHeapMb,
              longTaskCount: rawMetrics.longTasksCount,
              bytesTransferredKb: Math.round(rawMetrics.transferredBytes / 1024),
            });
          }

          // Compute aggregated statistics across 5 runs
          const sampleStats = medianAndRange(runSamples.map((s) => s.sampleCount));
          const firstFrameStats = medianAndRange(runSamples.map((s) => s.timeToFirstFrameMs));
          const p50RenderStats = medianAndRange(runSamples.map((s) => s.p50RenderTimeMs));
          const p95RenderStats = medianAndRange(runSamples.map((s) => s.p95RenderTimeMs));
          const p50DecodeStats = medianAndRange(runSamples.map((s) => s.p50DecodeTimeMs));
          const p95DecodeStats = medianAndRange(runSamples.map((s) => s.p95DecodeTimeMs));
          const p50FetchStats = medianAndRange(runSamples.map((s) => s.p50FetchTimeMs));
          const p95FetchStats = medianAndRange(runSamples.map((s) => s.p95FetchTimeMs));
          const hitRateStats = medianAndRange(runSamples.map((s) => s.cacheHitRatePct));
          const missedStats = medianAndRange(runSamples.map((s) => s.missedFramesCount));
          const availP95Stats = medianAndRange(runSamples.map((s) => s.p95AvailabilityLatencyMs));
          const meanErrStats = medianAndRange(runSamples.map((s) => s.meanFrameError));
          const maxErrStats = medianAndRange(runSamples.map((s) => s.maxFrameError));
          const peakCacheStats = medianAndRange(runSamples.map((s) => s.peakCacheMemoryMb));
          const peakHeapStats = medianAndRange(runSamples.map((s) => s.peakJSHeapMb));
          const longTaskStats = medianAndRange(runSamples.map((s) => s.longTaskCount));
          const bytesStats = medianAndRange(runSamples.map((s) => s.bytesTransferredKb));

          const flagLowSamples = sampleStats.median < 100;

          aggregatedResults.push({
            variant,
            protocol,
            networkProfile: config.network,
            cpuThrottle: config.cpu,
            scenario,
            runsCount: REPEAT_COUNT,
            timeToFirstFrame: firstFrameStats,
            sampleCount: { ...sampleStats, flagLowSamples },
            p50RenderTime: p50RenderStats,
            p95RenderTime: p95RenderStats,
            p50DecodeTime: p50DecodeStats,
            p95DecodeTime: p95DecodeStats,
            p50FetchTime: p50FetchStats,
            p95FetchTime: p95FetchStats,
            cacheHitRatePct: hitRateStats,
            missedFramesCount: missedStats,
            availabilityLatencyP95: availP95Stats,
            meanFrameError: meanErrStats,
            maxFrameError: maxErrStats,
            peakCacheMemoryMb: peakCacheStats,
            peakJSHeapMb: peakHeapStats,
            longTaskCount: longTaskStats,
            bytesTransferredKb: bytesStats,
          });

          console.log(
            `1stFrame: ${firstFrameStats.median}ms [${firstFrameStats.min}-${firstFrameStats.max}] | ` +
            `HitRate: ${hitRateStats.median}% | ` +
            `p95 Render: ${p95RenderStats.median}ms | ` +
            `p95 Decode: ${p95DecodeStats.median}ms | ` +
            `LongTasks: ${longTaskStats.median} | ` +
            `Samples: ${sampleStats.median}${flagLowSamples ? ' (FLAG: <100)' : ''}`
          );

          // Progressive persist after each scenario
          fs.writeFileSync(outJson, JSON.stringify(aggregatedResults, null, 2), 'utf-8');
        }
      }
    }

    await server.close();
  }

  await browser.close();

  // Save complete JSON results
  fs.writeFileSync(outJson, JSON.stringify(aggregatedResults, null, 2), 'utf-8');
  console.log(`\n💾 Comprehensive Benchmark results saved to ${outJson}`);

  return aggregatedResults;
}

if (process.argv[1]?.includes('run-benchmarks')) {
  runFullBenchmarkSuite().catch((err) => {
    console.error('Benchmark suite error:', err);
    process.exit(1);
  });
}
