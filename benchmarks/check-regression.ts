import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '@playwright/test';
import { startBenchmarkServer } from './server.js';

async function checkRegression() {
  const baselinePath = path.resolve('benchmarks/results/baseline.json');
  if (!fs.existsSync(baselinePath)) {
    console.error(`❌ Baseline file not found at ${baselinePath}. Run benchmarks/run-phase3-progression.ts first.`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const thresholds = baseline.thresholds;

  console.log('🛡️ Running Benchmark Regression Check (pnpm bench:check) against baseline.json...');

  const server = await startBenchmarkServer('http1', 4192);
  const browser = await chromium.launch({ headless: true });

  // Run unthrottled 30fps normal scrub check
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.goto(
    `${server.url}/benchmarks/index.html?manifest=/benchmarks/assets/variant-individual/manifest.json&smoothing=false`
  );
  await page.waitForFunction(() => (window as any).__ready === true, { timeout: 20000 });
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = [];
    const e = w.__engine;
    if (e) {
      e.totalDrawCalls = 0;
      e.missedFramesCount = 0;
      const c = e.getCache();
      c.hits = 0;
      c.misses = 0;
    }
  });

  for (let f = 1; f <= 60; f++) {
    await page.evaluate((p: number) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * p, behavior: 'auto' });
    }, f / 299);
    await page.waitForTimeout(33);
  }
  await page.waitForTimeout(100);

  const metrics = await page.evaluate(() => {
    const w = window as any;
    return {
      stats: w.__engine.stats(),
      longTaskCount: w.__longTasks ? w.__longTasks.length : 0,
    };
  });

  await context.close();
  await browser.close();
  await server.close();

  const failures: string[] = [];

  if (metrics.stats.hitRatePct < thresholds.unthrottled30fpsMinHitRatePct) {
    failures.push(
      `Hit rate regressed: measured ${metrics.stats.hitRatePct}% < threshold ${thresholds.unthrottled30fpsMinHitRatePct}%`
    );
  }

  if (metrics.longTaskCount > thresholds.unthrottled30fpsMaxLongTasks) {
    failures.push(
      `Long tasks regressed: measured ${metrics.longTaskCount} > threshold ${thresholds.unthrottled30fpsMaxLongTasks}`
    );
  }

  if (metrics.stats.renderTimeMs.p95 > thresholds.unthrottled30fpsMaxRenderP95Ms) {
    failures.push(
      `p95 render time regressed: measured ${metrics.stats.renderTimeMs.p95}ms > threshold ${thresholds.unthrottled30fpsMaxRenderP95Ms}ms`
    );
  }

  console.log(
    `📊 Measured: Hit Rate = ${metrics.stats.hitRatePct}% (min >= ${thresholds.unthrottled30fpsMinHitRatePct}%) | ` +
      `Long Tasks = ${metrics.longTaskCount} (max <= ${thresholds.unthrottled30fpsMaxLongTasks}) | ` +
      `p95 Render = ${metrics.stats.renderTimeMs.p95}ms (max <= ${thresholds.unthrottled30fpsMaxRenderP95Ms}ms)`
  );

  if (failures.length > 0) {
    console.error('❌ BENCHMARK REGRESSION DETECTED:');
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  console.log('✅ All regression checks PASSED.');
}

checkRegression().catch((err) => {
  console.error('Regression check error:', err);
  process.exit(1);
});
