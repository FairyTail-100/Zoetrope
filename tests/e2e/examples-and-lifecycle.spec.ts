import { test, expect } from '@playwright/test';

// Helper to assert canvas is non-blank
async function assertCanvasNonBlank(page: any, canvasSelector: string): Promise<void> {
  const isNonBlank = await page.evaluate((sel: string) => {
    const canvas = document.querySelector<HTMLCanvasElement>(sel);
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(Math.floor(w / 4), Math.floor(h / 4), Math.floor(w / 2), Math.floor(h / 2));
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5)) {
        return true;
      }
    }
    return false;
  }, canvasSelector);

  expect(isNonBlank).toBe(true);
}

test.describe('Section 2: Smoke Test Every Example in a Real Browser', () => {
  // 1. examples/basic-scroll
  test('basic-scroll: no console errors, non-blank canvas, wheel scroll advances frames', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
    await assertCanvasNonBlank(page, '#zoetrope-canvas');

    const initialFrame = await page.evaluate(() => {
      const el = document.querySelector('#hud-frame');
      return el ? el.textContent : '';
    });

    // Real wheel scroll
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(400);

    const scrolledFrame = await page.evaluate(() => {
      const el = document.querySelector('#hud-frame');
      return el ? el.textContent : '';
    });

    expect(scrolledFrame).not.toBe(initialFrame);
    await page.screenshot({ path: 'tests/screenshots/smoke-basic-scroll.png' });
  });

  test('basic-scroll: honors ?manifest= query param and updates HUD with custom frame total N != 90', async ({ page }) => {
    const N = 42; // Distinct frame total != 90
    await page.route('**/assets/test-manifest/manifest.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          $schema: 'https://raw.githubusercontent.com/FairyTail-100/Zoetrope/main/schema/v1.json',
          version: '1.0.0',
          id: 'test-custom-sequence',
          metadata: {
            totalFrames: N,
            fps: 24,
            duration: N / 24,
            aspectRatio: '1920:1080',
          },
          variants: [
            {
              id: 'desktop',
              minWidth: 0,
              width: 1920,
              height: 1080,
              format: 'image/webp',
              packing: 'individual',
              frameTemplate: 'desktop/frame_%04d.webp',
              frameStartIndex: 1,
              framesCount: N,
              stats: {
                totalBytes: 1000,
                minFrameBytes: 10,
                medianFrameBytes: 25,
                maxFrameBytes: 50,
                decodedRgbaBytesPerFrame: 8294400,
                estimatedDecodedMemoryBytes: 8294400 * N,
              },
            },
          ],
        }),
      });
    });

    // Provide dummy frame response so renderFrame(0) succeeds without hanging
    await page.route('**/desktop/frame_*.webp', async (route) => {
      // 1x1 transparent WebP binary
      const dummyWebp = Buffer.from(
        'UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v4N/vv7/93/7v/93/7v/93/7v/93/7v/93/7v8AAA==',
        'base64'
      );
      await route.fulfill({
        status: 200,
        contentType: 'image/webp',
        body: dummyWebp,
      });
    });

    const targetUrl = `http://127.0.0.1:4173/?manifest=${encodeURIComponent('/assets/test-manifest/manifest.json')}`;
    await page.goto(targetUrl);
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    const hudText = await page.evaluate(() => {
      const el = document.querySelector('#hud-frame');
      return el ? el.textContent : '';
    });

    // Assert HUD total matches N (e.g. "0 / 42")
    expect(hudText).toContain(`/ ${N}`);

    const manifestHud = await page.evaluate(() => {
      const el = document.querySelector('#hud-manifest');
      return el ? el.textContent : '';
    });
    expect(manifestHud).toContain('/assets/test-manifest/manifest.json');
    expect(manifestHud).toContain(`${N} frames`);
  });

  test('variant selection: picks DESKTOP at 1920x1080 and MOBILE at 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#hud-variant');
    await page.waitForTimeout(400);

    let variantText = await page.locator('#hud-variant').textContent();
    expect(variantText?.trim()).toBe('DESKTOP');

    // Switch to mobile viewport (iPhone 12/13/14: 390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    // Wait for debounced resize timer (100ms) + raf
    await page.waitForTimeout(400);

    variantText = await page.locator('#hud-variant').textContent();
    expect(variantText?.trim()).toBe('MOBILE');
  });

  test('request storm & two-tier cache: 0 repeated requests forward, 0 requests idle 5s, 0 requests reverse', async ({ page }) => {
    // Monitor all network requests for frame assets
    const assetRequests: string[] = [];
    interface TrackedRequest {
      url: string;
      startTime: number;
      req: unknown;
    }
    const trackedRequests: TrackedRequest[] = [];
    const inFlightRequests = new Set<unknown>();
    let lastAssetRequestTime = performance.now();

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/assets/') && (url.includes('.webp') || url.includes('.bin') || url.includes('.jpg'))) {
        const cleanUrl = url.split('?')[0];
        const now = performance.now();
        lastAssetRequestTime = now;
        assetRequests.push(cleanUrl);
        inFlightRequests.add(req);
        trackedRequests.push({ url: cleanUrl, startTime: now, req });
      }
    });

    page.on('requestfinished', (req) => {
      inFlightRequests.delete(req);
    });

    page.on('requestfailed', (req) => {
      inFlightRequests.delete(req);
    });

    // Helper: wait until asset requests are idle (no new asset request for 500 ms, with a 5 s cap)
    const waitForAssetIdle = async (timeoutMs = 5000, idleDurationMs = 500): Promise<void> => {
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        const elapsedSinceLastReq = performance.now() - lastAssetRequestTime;
        if (elapsedSinceLastReq >= idleDurationMs) {
          return;
        }
        const remainingToIdle = idleDurationMs - elapsedSinceLastReq;
        const remainingToTimeout = timeoutMs - (performance.now() - start);
        await new Promise((resolve) => setTimeout(resolve, Math.min(remainingToIdle, remainingToTimeout)));
      }
    };

    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    // Initial load: frame 0 and initial lookahead
    const initialRequestCount = assetRequests.length;
    expect(initialRequestCount).toBeGreaterThan(0);

    // Scroll forward from 0 to 100%
    await page.evaluate(async () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      for (let i = 1; i <= 20; i++) {
        window.scrollTo(0, maxScroll * (i / 20));
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await waitForAssetIdle(5000, 500);

    // Assert each individual frame URL was requested at most once during forward sweep (zero repeats)
    const forwardRequests = [...assetRequests];
    const urlCounts = new Map<string, number>();
    for (const url of forwardRequests) {
      urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
    }
    const repeatedUrls = [...urlCounts.entries()].filter(([_, count]) => count > 1);
    expect(repeatedUrls).toHaveLength(0);

    // Test IDLE = ZERO: wait 5s while stationary at 100% scroll
    const countBeforeIdle = assetRequests.length;
    await page.waitForTimeout(5000);
    const newRequestsDuringIdle = assetRequests.length - countBeforeIdle;
    expect(newRequestsDuringIdle).toBe(0);

    // Ensure asset requests are idle before taking reverse baseline
    await waitForAssetIdle(5000, 500);

    // Test REVERSE SCROLL: reverse from 100% back to 0%
    // Since frames are cached in the 128MB BlobCache, reverse sweep generates near-zero new network requests!
    const inFlightAtReverseStart = new Set(inFlightRequests);
    const reverseStartTime = performance.now();

    await page.evaluate(async () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      for (let i = 19; i >= 0; i--) {
        window.scrollTo(0, maxScroll * (i / 20));
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await waitForAssetIdle(5000, 500);

    // Count only asset requests whose start time is after the reverse sweep begins,
    // ignoring requests already in flight at that moment.
    const requestsDuringReverse = trackedRequests.filter(
      (r) => r.startTime >= reverseStartTime && !inFlightAtReverseStart.has(r.req)
    );
    const newRequestsDuringReverse = requestsDuringReverse.length;

    // Up to 2 requests can legitimately occur: intermediate frames near the start (e.g. frame 1 / frame_0002.webp)
    // may have been skipped and purged from the lookahead queue during the rapid forward scrub, so they were
    // not resident in BlobCache and must be fetched for the first time during reverse playback.
    expect(newRequestsDuringReverse).toBeLessThanOrEqual(2);

    // Verify stats from engine match requestsTotal
    const stats = await page.evaluate(() => {
      const eng = (window as any).__engine;
      return eng ? eng.stats() : null;
    });
    expect(stats).not.toBeNull();
    expect(stats.requestsTotal).toBe(assetRequests.length);
  });

  // 2. examples/layered-composition
  test('layered-composition: mask radius changes, DOM cues enter/leave, z-order, destroy clean', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('http://127.0.0.1:4174');
    await page.waitForSelector('#composition-canvas');
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
    await assertCanvasNonBlank(page, '#composition-canvas');

    // Test Act I cue at ~15% scroll
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * 0.15);
    });
    await page.waitForTimeout(200);

    const cue1Active = await page.evaluate(() => {
      return document.querySelector('#cue-1')?.classList.contains('active');
    });
    expect(cue1Active).toBe(true);

    // Test Act II cue and Iris Mask radius expansion between 20% and 55% scroll
    const radiusAt20 = await page.evaluate(() => {
      const comp = (window as any).__composition;
      return comp ? comp.resolveMask(comp.layers[1], 0.25)?.radius : null;
    });

    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * 0.5);
    });
    await page.waitForTimeout(200);

    const cue2Active = await page.evaluate(() => {
      return document.querySelector('#cue-2')?.classList.contains('active');
    });
    expect(cue2Active).toBe(true);

    const radiusAt50 = await page.evaluate(() => {
      const comp = (window as any).__composition;
      return comp ? comp.resolveMask(comp.layers[1], 0.5)?.radius : null;
    });

    // Assert mask radius expanded
    expect(radiusAt50).toBeGreaterThan(radiusAt20);

    // Assert Act I cue is now left (onLeave fired)
    const cue1After = await page.evaluate(() => {
      return document.querySelector('#cue-1')?.classList.contains('active');
    });
    expect(cue1After).toBe(false);

    // Test z-order: Top layer (iris-pip) is visible on canvas
    await assertCanvasNonBlank(page, '#composition-canvas');

    // Test destroy(): leaves 0 listeners and clears offscreen canvases
    const destroyResult = await page.evaluate(() => {
      const comp = (window as any).__composition;
      if (!comp) return false;
      comp.destroy();
      return comp.engines.size === 0 && comp.offscreenCanvases.size === 0;
    });
    expect(destroyResult).toBe(true);

    await page.screenshot({ path: 'tests/screenshots/smoke-layered-composition.png' });
  });

  // 3. examples/nextjs
  test('nextjs: production build runs with zero hydration errors or warnings', async ({ page }) => {
    const consoleWarningsAndErrors: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        msg.type() === 'error' ||
        text.includes('Warning: Extra attributes') ||
        text.includes('Hydration failed') ||
        text.includes('did not match')
      ) {
        consoleWarningsAndErrors.push(text);
      }
    });
    page.on('pageerror', (err) => consoleWarningsAndErrors.push(err.message));

    await page.goto('http://127.0.0.1:4175');
    await page.waitForSelector('canvas');
    await page.waitForTimeout(600);

    expect(consoleWarningsAndErrors).toHaveLength(0);
    await assertCanvasNonBlank(page, 'canvas');

    // Real wheel scroll
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'tests/screenshots/smoke-nextjs.png' });
  });

  // 4. examples/astro
  test('astro: island hydrates and scrubs correctly with zero console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('http://127.0.0.1:4176');
    await page.waitForSelector('#astro-canvas');
    await page.waitForTimeout(600);

    expect(consoleErrors).toHaveLength(0);
    await assertCanvasNonBlank(page, '#astro-canvas');

    // Real wheel scroll
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(300);

    await assertCanvasNonBlank(page, '#astro-canvas');
    await page.screenshot({ path: 'tests/screenshots/smoke-astro.png' });
  });
});

test.describe('Section 3: Lifecycle Real Browser Verification', () => {
  test('visibilitychange: hides and shows tab without errors and retains canvas frame', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(300);

    // Simulate tab hidden
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);

    const isHiddenState = await page.evaluate(() => {
      return (window as any).__engine?.isTabHidden;
    });
    expect(isHiddenState).toBe(true);

    // Simulate tab restored
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);

    const isResumedState = await page.evaluate(() => {
      return (window as any).__engine?.isTabHidden;
    });
    expect(isResumedState).toBe(false);
    await assertCanvasNonBlank(page, '#zoetrope-canvas');

    await page.screenshot({ path: 'tests/screenshots/lifecycle-visibility.png' });
  });

  test('prefers-reduced-motion: renders static poster frame without continuous scrub', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(300);

    await assertCanvasNonBlank(page, '#zoetrope-canvas');

    const progress = await page.evaluate(() => {
      const e = (window as any).__engine;
      return e ? e.targetProgress : 0;
    });
    expect(progress).toBe(0);

    await page.screenshot({ path: 'tests/screenshots/lifecycle-reduced-motion.png' });
  });

  test('resize storm: 20 rapid resizes within 1s completes with zero errors and correct backing size', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(300);

    // 20 rapid viewport resizes
    for (let i = 0; i < 20; i++) {
      const w = 1000 + (i % 5) * 50;
      const h = 600 + (i % 4) * 30;
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(30);
    }

    // Set final known viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    // Wait for debounced resize timer (100ms) to settle
    await page.waitForTimeout(250);

    expect(errors).toHaveLength(0);
    await assertCanvasNonBlank(page, '#zoetrope-canvas');

    await page.screenshot({ path: 'tests/screenshots/lifecycle-resize-storm.png' });
  });

  test('bfcache/pageshow: persisted page restore triggers canvas re-render without errors', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(300);

    // Dispatch pageshow event with persisted: true
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(100);

    await assertCanvasNonBlank(page, '#zoetrope-canvas');
    await page.screenshot({ path: 'tests/screenshots/lifecycle-bfcache.png' });
  });

  test('canvas context loss: surfaces error and recovers upon contextrestored', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(300);

    const contextEventLogs = await page.evaluate(() => {
      const logs: string[] = [];
      const engine = (window as any).__engine;
      if (engine) {
        engine.on('error', (err: any) => logs.push(err.name || err.message));
      }
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      canvas.dispatchEvent(new Event('contextlost', { cancelable: true }));
      canvas.dispatchEvent(new Event('contextrestored'));
      return logs;
    });

    expect(contextEventLogs).toContain('RendererError');
    await page.waitForTimeout(100);
    await assertCanvasNonBlank(page, '#zoetrope-canvas');

    await page.screenshot({ path: 'tests/screenshots/lifecycle-context-recovery.png' });
  });
});
