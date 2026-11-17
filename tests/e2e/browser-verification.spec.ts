import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.describe('Real Browser Verification & Failure Injection (Chromium)', () => {
  const screenshotsDir = path.resolve('tests/screenshots');

  test.beforeAll(() => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const distReleaseDir = path.resolve('dist-release');
    if (
      !fs.existsSync(path.join(distReleaseDir, 'no-build.html')) ||
      !fs.existsSync(path.join(distReleaseDir, 'zoetrope.min.js'))
    ) {
      const res = spawnSync('pnpm', ['release:build'], {
        cwd: path.resolve('.'),
        stdio: 'inherit',
        shell: true,
      });
      if (res.status !== 0) {
        throw new Error('Failed to build dist-release/ before running E2E tests.');
      }
    }
  });

  test('5: page loads with ZERO console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    expect(consoleErrors).toEqual([]);
  });

  test('no-build.html: loads through local static HTTP server and draws canvas frame', async ({ page }) => {
    const { ensureShowcaseAssets } = await import('../../scripts/ensure-showcase-assets.js');
    await ensureShowcaseAssets();

    const http = await import('node:http');
    const repoRoot = path.resolve('.');
    const distReleaseDir = path.join(repoRoot, 'dist-release');
    const showcaseDir = path.join(repoRoot, 'shared', 'assets', 'showcase');

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.webp': 'image/webp',
      '.map': 'application/json'
    };

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = parsedUrl.pathname;
      if (pathname === '/') pathname = '/no-build.html';

      res.setHeader('Access-Control-Allow-Origin', '*');

      let filePath: string;
      if (pathname.startsWith('/assets/showcase/')) {
        const rel = pathname.replace('/assets/showcase/', '');
        filePath = path.join(showcaseDir, rel);
      } else {
        filePath = path.join(distReleaseDir, pathname.replace(/^\//, ''));
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    const serverUrl = `http://127.0.0.1:${address.port}/no-build.html`;

    try {
      await page.goto(serverUrl);
      await page.waitForSelector('#viewport');
      await page.waitForFunction(() => {
        const el = document.querySelector('#hud-status');
        if (!el || !el.textContent || !el.textContent.includes('Ready')) return false;
        const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
        if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const cx = Math.floor(canvas.width / 2);
        const cy = Math.floor(canvas.height / 2);
        const w = Math.min(canvas.width, 100);
        const h = Math.min(canvas.height, 100);
        const imgData = ctx.getImageData(Math.max(0, cx - Math.floor(w / 2)), Math.max(0, cy - Math.floor(h / 2)), w, h);
        for (let i = 0; i < imgData.data.length; i += 4) {
          if (imgData.data[i + 3] > 0 && (imgData.data[i] > 10 || imgData.data[i + 1] > 10 || imgData.data[i + 2] > 10)) {
            return true;
          }
        }
        return false;
      }, { timeout: 10000 });

      const isDrawn = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const cx = Math.floor(canvas.width / 2);
        const cy = Math.floor(canvas.height / 2);
        const w = Math.min(canvas.width, 100);
        const h = Math.min(canvas.height, 100);
        const imgData = ctx.getImageData(Math.max(0, cx - Math.floor(w / 2)), Math.max(0, cy - Math.floor(h / 2)), w, h);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const a = imgData.data[i + 3];
          const r = imgData.data[i];
          const g = imgData.data[i + 1];
          const b = imgData.data[i + 2];
          if (a > 0 && (r > 10 || g > 10 || b > 10)) {
            return true;
          }
        }
        return false;
      });

      expect(isDrawn).toBe(true);
    } finally {
      server.close();
    }
  });

  test('4a: canvas is non-blank at initial load (pixel verification)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(800);

    // Verify non-blank by evaluating canvas pixel data in browser
    const isNonBlank = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      // Sample center 50x50 pixels
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const imgData = ctx.getImageData(cx - 25, cy - 25, 50, 50);

      // Check if any pixel has non-zero color or luminance
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        const a = imgData.data[i + 3];
        if (a > 0 && (r > 10 || g > 10 || b > 10)) {
          return true;
        }
      }
      return false;
    });

    expect(isNonBlank).toBe(true);

    // Save initial screenshot
    const shotPath = path.join(screenshotsDir, '01-initial-load.png');
    await page.screenshot({ path: shotPath });
    expect(fs.existsSync(shotPath)).toBe(true);
  });

  test('1b, 1c, 1d: deterministic real scroll sequence (0 -> 50 -> 100 -> 25 -> 75 -> 0) matches independent formula', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    // Disable smoothing for 100% deterministic frame targeting
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('#toggle-smoothing');
      if (btn && btn.textContent === 'ENABLED') {
        btn.click();
      }
    });

    const totalFrames = await page.evaluate(async () => {
      const res = await fetch('/assets/showcase/manifest.json');
      const manifest = await res.json();
      return Number(manifest.metadata.totalFrames);
    });
    expect(totalFrames).toBeGreaterThan(1);

    // Independent formula written in test: round(p * (N - 1))
    const calcExpectedFrame = (progress: number, total: number) => Math.round(progress * (total - 1));

    // Real scroll using window.scrollTo on tall document (actual ScrollDriver listening)
    const scrollToProgress = async (progress: number): Promise<number> => {
      await page.evaluate((p) => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: maxScroll * p, behavior: 'auto' });
      }, progress);

      // Allow paint to settle
      await page.waitForTimeout(200);

      const frameText = await page.textContent('#hud-frame');
      return parseInt(frameText?.split('/')[0].trim() || '0', 10);
    };

    // 1. Scroll to 0% -> Expected frame: round(0 * 89) = 0
    const f0 = await scrollToProgress(0.0);
    expect(f0).toBe(calcExpectedFrame(0.0, totalFrames));

    // 2. Scroll to 50% -> Expected frame: round(0.5 * 89) = 45
    const f50 = await scrollToProgress(0.5);
    expect(Math.abs(f50 - calcExpectedFrame(0.5, totalFrames))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotsDir, '02-scroll-50pct.png') });

    // 3. Scroll to 100% -> Expected frame: round(1.0 * 89) = 89
    const f100 = await scrollToProgress(1.0);
    expect(f100).toBe(calcExpectedFrame(1.0, totalFrames));
    await page.screenshot({ path: path.join(screenshotsDir, '03-scroll-100pct.png') });

    // 4. Reverse scroll to 25% -> Expected frame: round(0.25 * 89) = 22
    const f25 = await scrollToProgress(0.25);
    expect(Math.abs(f25 - calcExpectedFrame(0.25, totalFrames))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotsDir, '04-scroll-reverse-25pct.png') });

    // 5. Forward scroll to 75% -> Expected frame: round(0.75 * 89) = 67
    const f75 = await scrollToProgress(0.75);
    expect(Math.abs(f75 - calcExpectedFrame(0.75, totalFrames))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(screenshotsDir, '05-scroll-75pct.png') });

    // 6. Reverse scroll to 0% -> Expected frame: round(0 * 89) = 0
    const f0_end = await scrollToProgress(0.0);
    expect(f0_end).toBe(calcExpectedFrame(0.0, totalFrames));
  });

  test('1d-wheel: real mouse wheel scrolling drives animation progress', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    // Disable smoothing
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('#toggle-smoothing');
      if (btn && btn.textContent === 'ENABLED') {
        btn.click();
      }
    });

    // Dispatch real mouse wheel events
    const initialFrameText = await page.textContent('#hud-frame');
    const initialFrame = parseInt(initialFrameText?.split('/')[0].trim() || '0', 10);
    expect(initialFrame).toBe(0);

    // Scroll down by 800px using real mouse wheel
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);

    const scrolledFrameText = await page.textContent('#hud-frame');
    const scrolledFrame = parseInt(scrolledFrameText?.split('/')[0].trim() || '0', 10);

    // Real wheel should advance frame
    expect(scrolledFrame).toBeGreaterThan(0);
  });

  test('1e: abort-on-direction-reversal cancels stale requests with ZERO unhandled rejections', async ({ page }) => {
    const unhandledErrors: string[] = [];
    page.on('pageerror', (err) => {
      unhandledErrors.push(err.message);
    });

    let abortedRequestsCount = 0;
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText || '';
      if (failure.includes('ERR_ABORTED') || failure.includes('aborted') || failure.includes('canceled')) {
        abortedRequestsCount++;
      }
    });

    // Intercept frame image requests and add 120ms artificial delay to allow direction reversal to catch in-flight fetches
    await page.route('**/desktop/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.continue();
    });

    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(400);

    // Rapidly scroll forward from 0% to 60%
    await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: maxScroll * 0.6, behavior: 'auto' });
    });

    // Wait 40ms so requests for upcoming frames (e.g. 55-65) are actively in-flight
    await page.waitForTimeout(40);

    // Suddenly reverse direction and fling back to 10%
    await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: maxScroll * 0.1, behavior: 'auto' });
    });

    // Wait for network activity to settle
    await page.waitForTimeout(600);

    // Assert: Zero unhandled rejections
    expect(unhandledErrors).toEqual([]);

    // Assert: Stale requests were actually cancelled
    expect(abortedRequestsCount).toBeGreaterThan(0);
  });

  test('4c: viewport resize and DPR change updates canvas backing size and fills correctly', async ({ page, browser }) => {
    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    // Resize viewport to 1600x900 (engine debounces resize by 250ms by default)
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
      return canvas && canvas.width === Math.round(1600 * dpr) && canvas.height === Math.round(900 * dpr);
    });

    const dims1 = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      return { width: canvas.width, height: canvas.height, dpr: window.devicePixelRatio };
    });

    expect(dims1.width).toBe(Math.round(1600 * dims1.dpr));
    expect(dims1.height).toBe(Math.round(900 * dims1.dpr));

    // Resize to mobile viewport 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
      return canvas && canvas.width === Math.round(390 * dpr) && canvas.height === Math.round(844 * dpr);
    });

    const dims2 = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      return { width: canvas.width, height: canvas.height, dpr: window.devicePixelRatio };
    });

    expect(dims2.width).toBe(Math.round(390 * dims2.dpr));
    expect(dims2.height).toBe(Math.round(844 * dims2.dpr));

    await page.screenshot({ path: path.join(screenshotsDir, '06-mobile-resize.png') });

    // Verify DPR=2 scales canvas backing size by 2x
    const hiDpiContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    try {
      const hiDpiPage = await hiDpiContext.newPage();
      await hiDpiPage.goto('/');
      await hiDpiPage.waitForSelector('#zoetrope-canvas');
      await hiDpiPage.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas');
        return canvas && canvas.width === 780 && canvas.height === 1688;
      });
    } finally {
      await hiDpiContext.close();
    }
  });

  test('6a: route interception 404 fault injection -> error handled, canvas never blank', async ({ page }) => {
    // Intercept frame_0045.webp to return 404
    await page.route('**/frame_0045.webp', (route) => {
      route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found',
      });
    });

    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(400);

    // Scroll to 50% (where frame 45 is located)
    await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: maxScroll * 0.5, behavior: 'auto' });
    });
    await page.waitForTimeout(300);

    // Verify canvas is NOT blank
    const isDrawn = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(canvas.width / 2 - 20, canvas.height / 2 - 20, 40, 40).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10)) {
          return true;
        }
      }
      return false;
    });

    expect(isDrawn).toBe(true);
    await page.screenshot({ path: path.join(screenshotsDir, '07-fault-404-fallback.png') });
  });

  test('6b: route interception corrupt bytes -> decode error handled, canvas keeps fallback', async ({ page }) => {
    // Intercept frame_0060.webp to return corrupt bytes
    await page.route('**/frame_0060.webp', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/webp',
        body: Buffer.from([0x00, 0xff, 0x12, 0x34, 0x56, 0x78]), // Corrupt payload
      });
    });

    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(400);

    // Scroll to ~66% (frame 60)
    await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: maxScroll * 0.66, behavior: 'auto' });
    });
    await page.waitForTimeout(300);

    // Canvas must still be showing valid fallback pixels
    const isDrawn = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(canvas.width / 2 - 20, canvas.height / 2 - 20, 40, 40).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10)) {
          return true;
        }
      }
      return false;
    });

    expect(isDrawn).toBe(true);
    await page.screenshot({ path: path.join(screenshotsDir, '08-fault-corrupt-fallback.png') });
  });

  test('A3-mobile: mobile emulation (Pixel 7) selects mobile variant and auto budget is below desktop budget', async ({ browser }) => {
    // 1. Desktop context (default 8GB deviceMemory on desktop Chromium)
    const desktopContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1.0,
      hasTouch: false,
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto('/');
    await desktopPage.waitForSelector('#zoetrope-canvas');

    const desktopStats = await desktopPage.evaluate(() => {
      const w = window as any;
      const engine = w.__engine;
      return {
        variantId: engine ? engine.getCurrentVariant()?.id : null,
        budgetBytes: engine ? engine.getCache().getStats().maxBytes : 0,
      };
    });

    // 2. Mobile emulation: Pixel 7 (412x915, DPR 2.625, pointer: coarse) with deviceMemory unset (Safari/iOS WebKit fallback)
    const mobileUnsetContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      hasTouch: true,
      isMobile: true,
    });
    await mobileUnsetContext.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        get: () => undefined,
        configurable: true,
      });
    });
    const mobileUnsetPage = await mobileUnsetContext.newPage();
    await mobileUnsetPage.goto('/');
    await mobileUnsetPage.waitForSelector('#zoetrope-canvas');

    const mobileUnsetStats = await mobileUnsetPage.evaluate(() => {
      const w = window as any;
      const engine = w.__engine;
      return {
        variantId: engine ? engine.getCurrentVariant()?.id : null,
        budgetBytes: engine ? engine.getCache().getStats().maxBytes : 0,
      };
    });

    // 3. Mobile emulation: Pixel 7 with deviceMemory explicitly set to 4 GB
    const mobile4GBContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      hasTouch: true,
      isMobile: true,
    });
    await mobile4GBContext.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        get: () => 4,
        configurable: true,
      });
    });
    const mobile4GBPage = await mobile4GBContext.newPage();
    await mobile4GBPage.goto('/');
    await mobile4GBPage.waitForSelector('#zoetrope-canvas');

    const mobile4GBStats = await mobile4GBPage.evaluate(() => {
      const w = window as any;
      const engine = w.__engine;
      return {
        variantId: engine ? engine.getCurrentVariant()?.id : null,
        budgetBytes: engine ? engine.getCache().getStats().maxBytes : 0,
      };
    });

    await desktopContext.close();
    await mobileUnsetContext.close();
    await mobile4GBContext.close();

    // Assert mobile variant selected on Pixel 7
    expect(mobileUnsetStats.variantId).toBe('mobile');
    expect(mobile4GBStats.variantId).toBe('mobile');
    expect(desktopStats.variantId).toBe('desktop');

    // Assert mobile auto budget (unset / Safari fallback) is strictly below desktop budget
    expect(mobileUnsetStats.budgetBytes).toBeLessThan(desktopStats.budgetBytes);
    // Assert mobile 4GB budget (240MB) is strictly below desktop 8GB budget (450MB)
    expect(mobile4GBStats.budgetBytes).toBe(240 * 1024 * 1024);
    expect(mobile4GBStats.budgetBytes).toBeLessThan(desktopStats.budgetBytes);
  });

  test('F7-negotiate: multi-format manifest (AVIF + WebP) falls back to WebP when AVIF trial decode fails', async ({ page }) => {
    // 1. Intercept manifest.json to declare multi-format sources: AVIF primary, WebP fallback
    await page.route('**/assets/showcase/manifest.json', async (route) => {
      const response = await route.fetch();
      const manifest = await response.json();
      const desktopVar = manifest.variants[0];
      desktopVar.formats = ['image/avif', 'image/webp'];
      desktopVar.sources = [
        {
          format: 'image/avif',
          frameTemplate: 'desktop-frames/frame_%04d.avif',
          frameStartIndex: 1,
          framesCount: 90,
        },
        {
          format: 'image/webp',
          frames: desktopVar.frames,
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(manifest),
      });
    });

    // 2. Force AVIF trial decode to fail in browser (simulating browser without AV1/AVIF decoder)
    await page.addInitScript(() => {
      const origCreateImageBitmap = window.createImageBitmap.bind(window);
      (window as any).__avifProbed = 0;
      (window as any).__webpProbed = 0;
      (window as any).createImageBitmap = async function (image: ImageBitmapSource, ...args: any[]) {
        if (image instanceof Blob) {
          if (image.type === 'image/avif') {
            (window as any).__avifProbed++;
            throw new DOMException('The source image could not be decoded (simulated AVIF unsupported)', 'EncodingError');
          }
          if (image.type === 'image/webp') {
            (window as any).__webpProbed++;
          }
        }
        return (origCreateImageBitmap as any)(image, ...args);
      };
    });

    await page.goto('/');
    await page.waitForSelector('#zoetrope-canvas');
    await page.waitForTimeout(500);

    const negotiationResult = await page.evaluate(() => {
      const w = window as any;
      const engine = w.__engine;
      const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(canvas.width / 2 - 10, canvas.height / 2 - 10, 20, 20).data;
      let nonBlank = false;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10)) {
          nonBlank = true;
          break;
        }
      }
      return {
        avifProbed: w.__avifProbed,
        webpProbed: w.__webpProbed,
        selectedFormat: engine ? engine.getCurrentVariant()?.format : null,
        nonBlank,
      };
    });

    expect(negotiationResult.avifProbed).toBeGreaterThanOrEqual(1);
    expect(negotiationResult.webpProbed).toBeGreaterThanOrEqual(1);
    expect(negotiationResult.selectedFormat).toBe('image/webp');
    expect(negotiationResult.nonBlank).toBe(true);
  });
});
