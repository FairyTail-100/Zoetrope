import { chromium } from '@playwright/test';
import { startBenchmarkServer } from './server.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface TimingEvent {
  name: string;
  timestampMs: number; // Relative to navigationStart (0.0ms)
  durationMs?: number;
  bytes?: number;
}

async function measureFrame0ColdBreakdown() {
  console.log('🔬 Measuring Frame 0 Cold Timing Breakdown on Fast 3G + 4x CPU...');

  const server = await startBenchmarkServer('http1', 4185);
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // Enable Network domain to capture requests
  await cdp.send('Network.enable');

  // Strictly disable cache
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // Emulate Fast 3G (1.6 Mbps download, 750 kbps upload, 40ms RTT)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbps = 204,800 B/s
    uploadThroughput: (750 * 1024) / 8,
    latency: 40, // 40ms RTT
  });

  // Emulate 4x CPU slowdown
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const networkRequests: Map<string, { start: number; end: number; bytes: number }> = new Map();

  cdp.on('Network.requestWillBeSent', (e) => {
    networkRequests.set(e.request.url, {
      start: e.timestamp,
      end: 0,
      bytes: 0,
    });
  });

  cdp.on('Network.loadingFinished', (e) => {
    for (const [url, req] of networkRequests.entries()) {
      if (req.end === 0) {
        req.end = e.timestamp;
        req.bytes = e.encodedDataLength;
      }
    }
  });

  const manifestPath = `/benchmarks/assets/variant-individual/manifest.json`;
  const url = `${server.url}/benchmarks/index.html?manifest=${encodeURIComponent(manifestPath)}&smoothing=false`;

  await page.goto(url);
  await page.waitForFunction(() => (window as any).__firstFrameTime !== null, { timeout: 30000 });
  // Allow last network buffer metrics to settle
  await page.waitForTimeout(500);

  // Extract browser performance entries
  const timingReport = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const bundleRes = resources.find((r) => r.name.includes('engine.bundle.js'));
    const manifestRes = resources.find((r) => r.name.includes('manifest.json'));
    const frame0Res = resources.find((r) => r.name.includes('frame_0001.webp') || r.name.includes('f_0000.webp'));
    const w = window as any;

    return {
      timeOrigin: performance.timeOrigin,
      nav: nav
        ? {
            requestStart: Math.round(nav.requestStart * 10) / 10,
            responseEnd: Math.round(nav.responseEnd * 10) / 10,
            domInteractive: Math.round(nav.domInteractive * 10) / 10,
            transferSize: nav.transferSize || nav.encodedBodySize || 0,
          }
        : null,
      bundle: bundleRes
        ? {
            startTime: Math.round(bundleRes.startTime * 10) / 10,
            responseEnd: Math.round(bundleRes.responseEnd * 10) / 10,
            duration: Math.round(bundleRes.duration * 10) / 10,
            transferSize: bundleRes.transferSize || bundleRes.encodedBodySize || 0,
          }
        : null,
      manifest: manifestRes
        ? {
            startTime: Math.round(manifestRes.startTime * 10) / 10,
            responseEnd: Math.round(manifestRes.responseEnd * 10) / 10,
            duration: Math.round(manifestRes.duration * 10) / 10,
            transferSize: manifestRes.transferSize || manifestRes.encodedBodySize || 0,
          }
        : null,
      frame0: frame0Res
        ? {
            startTime: Math.round(frame0Res.startTime * 10) / 10,
            responseEnd: Math.round(frame0Res.responseEnd * 10) / 10,
            duration: Math.round(frame0Res.duration * 10) / 10,
            transferSize: frame0Res.transferSize || frame0Res.encodedBodySize || 0,
          }
        : null,
      firstFrameTimeFromNavStart: w.__firstFrameTime,
      decodeTimeMs: w.__decodeTimes?.[0] ?? null,
      renderTimeMs: w.__renderTimes?.[0] ?? null,
    };
  });

  await browser.close();
  await server.close();

  // Print exact breakdown
  console.log('\n======================================================');
  console.log('⏱️  COLD FIRST-FRAME TIMING BREAKDOWN (Fast 3G + 4x CPU)');
  console.log('======================================================');
  console.log(`0.0 ms   -> navigationStart (timeOrigin)`);
  if (timingReport.nav) {
    console.log(`${timingReport.nav.requestStart.toFixed(1)} ms  -> index.html fetch start`);
    console.log(`${timingReport.nav.responseEnd.toFixed(1)} ms  -> index.html responseEnd (${timingReport.nav.transferSize} bytes, 40ms RTT)`);
  }
  if (timingReport.bundle) {
    console.log(`${timingReport.bundle.startTime.toFixed(1)} ms -> engine.bundle.js fetch start (discovered by HTML parser)`);
    console.log(`${timingReport.bundle.responseEnd.toFixed(1)} ms -> engine.bundle.js fetched (${timingReport.bundle.duration.toFixed(1)} ms duration, ${timingReport.bundle.transferSize} bytes @ 1.6 Mbps + 40ms RTT)`);
  }
  if (timingReport.manifest) {
    const evalMs = timingReport.bundle ? Math.max(0, timingReport.manifest.startTime - timingReport.bundle.responseEnd) : 0;
    console.log(`${timingReport.manifest.startTime.toFixed(1)} ms -> manifest.json fetch start (${evalMs.toFixed(1)} ms ES module parse/eval under 4x CPU + engine.init())`);
    console.log(`${timingReport.manifest.responseEnd.toFixed(1)} ms -> manifest.json fetched (${timingReport.manifest.duration.toFixed(1)} ms duration, ${timingReport.manifest.transferSize} bytes)`);
  }
  if (timingReport.frame0) {
    console.log(`${timingReport.frame0.startTime.toFixed(1)} ms -> frame 0 fetch start`);
    console.log(`${timingReport.frame0.responseEnd.toFixed(1)} ms -> frame 0 fetch end (${timingReport.frame0.duration.toFixed(1)} ms duration, ${timingReport.frame0.transferSize} bytes)`);
  }
  const decodeStart = timingReport.frame0?.responseEnd ?? 0;
  const decodeMs = timingReport.decodeTimeMs ?? 0;
  const decodeEnd = decodeStart + decodeMs;
  const renderMs = timingReport.renderTimeMs ?? 0;
  const drawDone = decodeEnd + renderMs;

  console.log(`${decodeStart.toFixed(1)} ms -> decode start`);
  console.log(`${decodeEnd.toFixed(1)} ms -> decode end (${decodeMs.toFixed(1)} ms decode time)`);
  console.log(`${drawDone.toFixed(1)} ms -> drawImage done (${renderMs.toFixed(2)} ms draw time)`);
  console.log('======================================================');
  console.log(`Total Cold Time to First Frame: ${drawDone.toFixed(1)} ms from navigationStart`);
  console.log('======================================================\n');
}

measureFrame0ColdBreakdown().catch(console.error);
