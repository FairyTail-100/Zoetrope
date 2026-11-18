import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ScaffoldOptions {
  targetDir: string;
  projectName?: string;
  published?: boolean;
}

export function scaffoldProject(options: ScaffoldOptions): string {
  const targetDir = path.resolve(options.targetDir);
  const projectName = options.projectName || path.basename(targetDir);
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const distReleaseDir = path.join(repoRoot, 'dist-release');

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'public', 'assets', 'demo', 'desktop'), { recursive: true });

  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const version = rootPkg.version;

  let dependencies: Record<string, string> = {};

  if (options.published) {
    // Mode B: published npm ranges (unverified until published to registry)
    dependencies = {
      '@zoetropejs/core': `^${version}`
    };
  } else {
    // Mode A (Default): Portable vendor tarballs that work anywhere, including outside this monorepo
    const vendorDir = path.join(targetDir, 'vendor');
    fs.mkdirSync(vendorDir, { recursive: true });

    // Ensure release tarballs exist
    const requiredTarballs = [
      `zoetropejs-core-${version}.tgz`,
      `zoetropejs-manifest-${version}.tgz`,
      `zoetropejs-cache-${version}.tgz`,
      `zoetropejs-motion-${version}.tgz`,
      `zoetropejs-decoder-${version}.tgz`,
      `zoetropejs-streaming-${version}.tgz`,
      `zoetropejs-renderer-${version}.tgz`
    ];

    const hasAllTarballs = requiredTarballs.every(t => fs.existsSync(path.join(distReleaseDir, t)));
    if (!hasAllTarballs) {
      console.log('[scaffold] Packing missing release tarballs to dist-release...');
      fs.mkdirSync(distReleaseDir, { recursive: true });
      spawnSync('pnpm', ['-r', '--filter="./packages/*"', 'pack', '--pack-destination', distReleaseDir], {
        cwd: repoRoot,
        stdio: 'pipe',
        shell: true
      });
    }

    // Copy tarballs into vendor/
    for (const tgz of requiredTarballs) {
      const src = path.join(distReleaseDir, tgz);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(vendorDir, tgz));
      }
    }

    dependencies = {
      '@zoetropejs/core': `file:./vendor/zoetropejs-core-${version}.tgz`
    };
  }

  // 1. package.json
  const pkgJson = {
    name: projectName,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    dependencies,
    devDependencies: {
      typescript: '^5.7.3',
      vite: '^6.2.0'
    }
  };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

  // 2. Local workspace and build approval configuration
  const pnpmWorkspace = `allowBuilds:
  esbuild: true

onlyBuiltDependencies:
  - esbuild
`;
  fs.writeFileSync(path.join(targetDir, 'pnpm-workspace.yaml'), pnpmWorkspace, 'utf-8');

  // 3. .npmrc
  const npmrc = `shared-workspace-lockfile=false
`;
  fs.writeFileSync(path.join(targetDir, '.npmrc'), npmrc, 'utf-8');

  // 4. vite.config.ts
  const viteConfig = `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  }
});
`;
  fs.writeFileSync(path.join(targetDir, 'vite.config.ts'), viteConfig, 'utf-8');

  // 5. index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0b0c10; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-x: hidden; }
      .scroll-container { height: 300vh; position: relative; }
      .viewport-pin { position: sticky; top: 0; width: 100vw; height: 100vh; overflow: hidden; }
      canvas { width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <div class="scroll-container">
      <div class="viewport-pin">
        <canvas id="viewport"></canvas>
      </div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtml, 'utf-8');

  // 6. src/main.ts
  const mainTs = `import { Zoetrope } from '@zoetropejs/core';

async function init() {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (canvas) {
    const urlParams = new URLSearchParams(window.location.search);
    let manifestUrl = urlParams.get('manifest') 
      ? decodeURIComponent(urlParams.get('manifest')!)
      : '';

    if (!manifestUrl) {
      const heroExists = await fetch('/assets/hero/manifest.json', { method: 'HEAD' })
        .then((r) => r.ok)
        .catch(() => false);
      manifestUrl = heroExists ? '/assets/hero/manifest.json' : '/assets/demo/manifest.json';
    }

    const engine = new Zoetrope({
      manifest: manifestUrl,
      canvas,
      renderer: { fit: 'cover' }
    });

    await engine.init();

    window.addEventListener('beforeunload', () => {
      engine.destroy();
    });
  }
}

init().catch(console.error);
`;
  fs.writeFileSync(path.join(targetDir, 'src', 'main.ts'), mainTs, 'utf-8');

  // 7. Minimal valid WebP placeholder frames & manifest
  const tinyWebP = Buffer.from(
    'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=',
    'base64'
  );
  fs.writeFileSync(
    path.join(targetDir, 'public', 'assets', 'demo', 'desktop', 'frame_0000.webp'),
    tinyWebP
  );
  fs.writeFileSync(
    path.join(targetDir, 'public', 'assets', 'demo', 'desktop', 'frame_0001.webp'),
    tinyWebP
  );

  const manifest = {
    id: projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'demo',
    version: '1.0.0',
    metadata: {
      fps: 24,
      totalFrames: 2,
      duration: 0.083,
      packingMode: 'individual',
      sourceColorSpace: 'bt709',
      sourceColorRange: 'tv'
    },
    variants: [
      {
        id: 'desktop',
        width: 1920,
        height: 1080,
        minWidth: 768,
        packing: 'individual',
        format: 'image/webp',
        frameTemplate: '/assets/demo/desktop/frame_%04d.webp',
        frameCount: 2
      },
      {
        id: 'mobile',
        width: 640,
        height: 360,
        minWidth: 0,
        packing: 'individual',
        format: 'image/webp',
        frameTemplate: '/assets/demo/desktop/frame_%04d.webp',
        frameCount: 2
      }
    ]
  };
  fs.writeFileSync(
    path.join(targetDir, 'public', 'assets', 'demo', 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  // 8. README.md
  const readme = `# ${projectName}

Created with Zoetrope Scaffolder.

## Development

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Production Build

\`\`\`bash
pnpm build
pnpm preview
\`\`\`
`;
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme, 'utf-8');

  return targetDir;
}

if (process.argv[1] && process.argv[1].endsWith('new-project.ts')) {
  const isPublished = process.argv.includes('--published');
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const target = positionalArgs[0];
  const name = positionalArgs[1];

  if (!target) {
    console.error('Usage: tsx scripts/new-project.ts <target-dir> [projectName] [--published]');
    process.exit(1);
  }
  const dir = scaffoldProject({ targetDir: target, projectName: name, published: isPublished });
  console.log(`Scaffolded new project at: ${dir} (${isPublished ? 'published npm mode' : 'portable vendor tarball mode'})`);
}
