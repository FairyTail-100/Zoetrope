import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { scaffoldProject } from './new-project.js';
import { runFFmpeg } from '../packages/compiler/src/ffmpeg.js';
import { compile } from '../packages/compiler/src/compiler.js';

export async function runScaffoldSmokeTest(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const artifactsTestApp = path.join(repoRoot, '.artifacts', 'test-app');
  const outsideTempDir = path.join(
    os.tmpdir(),
    `zoetrope-outside-scaffold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  console.log(`[test:scaffold] Starting smoke test...`);
  console.log(`[test:scaffold] Outside temp directory: ${outsideTempDir}`);

  let server: http.Server | null = null;
  let browser: any = null;

  try {
    // Clean any prior artifacts/test-app
    if (fs.existsSync(artifactsTestApp)) {
      fs.rmSync(artifactsTestApp, { recursive: true, force: true });
    }

    // 1. Scaffold into external temp dir (outside this repository)
    console.log('[test:scaffold] Scaffolding into outside temp dir...');
    scaffoldProject({ targetDir: outsideTempDir, projectName: 'outside-test-app' });

    // Verify package.json contains NO workspace: references
    const pkgContent = fs.readFileSync(path.join(outsideTempDir, 'package.json'), 'utf-8');
    if (pkgContent.includes('workspace:')) {
      throw new Error('[test:scaffold] FAILED: package.json contains "workspace:"');
    }
    const pkg = JSON.parse(pkgContent);
    if (!pkg.dependencies?.['@zoetropejs/core']?.startsWith('file:./vendor/')) {
      throw new Error(
        `[test:scaffold] FAILED: expected file:./vendor/ dependency, got ${pkg.dependencies?.['@zoetropejs/core']}`
      );
    }
    if (pkg.pnpm !== undefined) {
      throw new Error('[test:scaffold] FAILED: unused "pnpm" field still present in package.json');
    }
    console.log('[test:scaffold] Verified package.json uses portable file:./vendor/*.tgz dependencies and no pnpm field.');

    const workspaceYamlPath = path.join(outsideTempDir, 'pnpm-workspace.yaml');
    if (!fs.existsSync(workspaceYamlPath)) {
      throw new Error('[test:scaffold] FAILED: pnpm-workspace.yaml was not generated in fresh scaffold');
    }
    const workspaceYamlContent = fs.readFileSync(workspaceYamlPath, 'utf-8');
    if (!workspaceYamlContent.includes('allowBuilds:') || !workspaceYamlContent.includes('esbuild: true')) {
      throw new Error('[test:scaffold] FAILED: pnpm-workspace.yaml does not contain allowBuilds for esbuild');
    }
    console.log('[test:scaffold] Verified pnpm-workspace.yaml generated with allowBuilds configuration.');

    // 2. Run pnpm install with empty pnpm configuration to guarantee isolation
    console.log('[test:scaffold] Running pnpm install in outside temp dir with empty pnpm config...');
    const emptyNpmrc = path.join(outsideTempDir, '.empty-npmrc');
    fs.writeFileSync(emptyNpmrc, '');
    const emptyPnpmEnv = {
      ...process.env,
      npm_config_userconfig: emptyNpmrc,
      NPM_CONFIG_USERCONFIG: emptyNpmrc,
      npm_config_globalconfig: emptyNpmrc,
      NPM_CONFIG_GLOBALCONFIG: emptyNpmrc,
    };

    const installRes = spawnSync('pnpm install --allow-build=esbuild', {
      cwd: outsideTempDir,
      stdio: 'inherit',
      shell: true,
      env: emptyPnpmEnv
    });

    if (installRes.status !== 0) {
      throw new Error(`[test:scaffold] FAILED: pnpm install exited with non-zero code ${installRes.status}`);
    }
    console.log('[test:scaffold] pnpm install completed successfully with code 0.');

    // 3. Compile a real test video clip into public/assets/hero
    const testClipPath = path.join(outsideTempDir, 'testsrc.mp4');
    console.log('[test:scaffold] Generating 2s synthetic test clip via FFmpeg...');
    await runFFmpeg([
      '-f', 'lavfi',
      '-i', 'testsrc=duration=2:size=320x240:rate=12',
      '-pix_fmt', 'yuv420p',
      '-y',
      testClipPath
    ]);

    const heroOutDir = path.join(outsideTempDir, 'public', 'assets', 'hero');
    console.log('[test:scaffold] Compiling clip into public/assets/hero...');
    await compile({
      input: testClipPath,
      outputDir: heroOutDir,
      id: 'test-hero',
      fps: 12,
      format: 'webp',
      quality: 80,
      variants: [
        { id: 'desktop', width: 320, height: 240, minWidth: 768 },
        { id: 'mobile', width: 320, height: 240, minWidth: 0 }
      ]
    });
    console.log('[test:scaffold] Real clip compiled to public/assets/hero.');

    // 4. Run pnpm build
    console.log('[test:scaffold] Running pnpm build in outside temp dir...');
    const buildRes = spawnSync('pnpm build', {
      cwd: outsideTempDir,
      stdio: 'inherit',
      shell: true
    });
    if (buildRes.status !== 0) {
      throw new Error('[test:scaffold] FAILED: pnpm build exited with code ' + buildRes.status);
    }

    // 5. Assert dist/ exists and contains bundle
    const distHtml = path.join(outsideTempDir, 'dist', 'index.html');
    const distAssets = path.join(outsideTempDir, 'dist', 'assets');
    if (!fs.existsSync(distHtml)) {
      throw new Error('[test:scaffold] FAILED: dist/index.html was not generated');
    }
    const jsFiles = fs.existsSync(distAssets) ? fs.readdirSync(distAssets).filter(f => f.endsWith('.js')) : [];
    if (jsFiles.length === 0) {
      throw new Error('[test:scaffold] FAILED: bundled JS missing from dist/assets');
    }
    console.log(`[test:scaffold] Outside project verified: dist/ generated (${jsFiles.join(', ')}).`);

    // 6. Real browser regression verification with Playwright (Chromium)
    console.log('[test:scaffold] Starting local static HTTP server for dist/...');
    const distDir = path.join(outsideTempDir, 'dist');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.webp': 'image/webp',
      '.css': 'text/css'
    };

    server = http.createServer((req, res) => {
      let reqPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (reqPath === '/') reqPath = '/index.html';
      const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(distDir, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as any).port;
    console.log(`[test:scaffold] Serving external app on http://127.0.0.1:${port}/`);

    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });

    const consoleErrors: string[] = [];
    const frameResponses: string[] = [];
    const allRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('request', (req) => {
      allRequests.push(req.url());
    });

    page.on('response', (res) => {
      if (res.url().includes('frame_') && res.status() === 200) {
        frameResponses.push(res.url());
      }
    });

    console.log(`[test:scaffold] Navigating to http://127.0.0.1:${port}/ ...`);
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('canvas#viewport');
    await page.waitForTimeout(1000);

    console.log(`[test:scaffold] Browser console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      throw new Error(`[test:scaffold] Browser console errors detected:\n${consoleErrors.join('\n')}`);
    }

    console.log(`[test:scaffold] 200 OK frame responses received: ${frameResponses.length}`);
    if (frameResponses.length === 0) {
      throw new Error('[test:scaffold] FAILED: Expected at least one frame_*.webp request with HTTP 200');
    }

    const hasPixels = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas#viewport');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const sampleW = Math.min(canvas.width, 200);
      const sampleH = Math.min(canvas.height, 200);
      const imgData = ctx.getImageData(0, 0, sampleW, sampleH).data;
      for (let i = 0; i < imgData.length; i += 4) {
        if (imgData[i] !== 0 || imgData[i + 1] !== 0 || imgData[i + 2] !== 0 || imgData[i + 3] !== 0) {
          return true;
        }
      }
      return false;
    });

    console.log(`[test:scaffold] Canvas non-blank pixel verification: ${hasPixels}`);
    if (!hasPixels) {
      throw new Error('[test:scaffold] FAILED: Canvas contains only blank/zero pixels');
    }

    // Check: at 1920x1080 scroll forward then reverse and assert no request path contains /mobile/
    console.log('[test:scaffold] Testing scroll forward then reverse at 1920x1080...');
    await page.evaluate(async () => {
      window.scrollTo(0, 800);
      await new Promise((r) => setTimeout(r, 150));
      window.scrollTo(0, 1600);
      await new Promise((r) => setTimeout(r, 150));
      window.scrollTo(0, 900);
      await new Promise((r) => setTimeout(r, 150));
      window.scrollTo(0, 200);
    });
    await page.waitForTimeout(500);

    const mobileRequests = allRequests.filter((url) => url.includes('/mobile/'));
    console.log(`[test:scaffold] Mobile requests detected after reversal at 1920x1080: ${mobileRequests.length}`);
    if (mobileRequests.length > 0) {
      throw new Error(`[test:scaffold] FAILED: Mobile variant requested at 1920x1080 viewport after reversal:\n${mobileRequests.join('\n')}`);
    }

    console.log('[test:scaffold] All assertions (build, browser, HTTP 200 frames, non-blank canvas, no mobile on reversal) passed successfully.');
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    if (server) {
      try {
        server.close();
      } catch {}
    }
    // Guaranteed cleanup on success and failure
    console.log('[test:scaffold] Cleaning up temporary directories...');
    try {
      if (fs.existsSync(outsideTempDir)) {
        fs.rmSync(outsideTempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(artifactsTestApp)) {
        fs.rmSync(artifactsTestApp, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore directory lock cleanup issues on Windows
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('test-scaffold.ts')) {
  try {
    await runScaffoldSmokeTest();
    console.log('[test:scaffold] Finished with exit code 0.');
  } catch (err: any) {
    console.error(err.message || err);
    process.exit(1);
  }
}
