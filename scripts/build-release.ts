import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkVersions } from './check-version.js';
import { zipSkills } from './zip-skills.js';

export async function buildRelease(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const distReleaseDir = path.join(repoRoot, 'dist-release');

  console.log('[release:build] Verifying monorepo version consistency...');
  const versionCheck = checkVersions();
  if (!versionCheck.success) {
    throw new Error('Version mismatch:\n' + versionCheck.mismatches.join('\n'));
  }
  const version = versionCheck.version;
  console.log(`[release:build] Building release for version v${version}...`);

  fs.mkdirSync(distReleaseDir, { recursive: true });
  // Clean prior tarballs from dist-release
  for (const f of fs.readdirSync(distReleaseDir)) {
    if (f.endsWith('.tgz')) {
      fs.unlinkSync(path.join(distReleaseDir, f));
    }
  }

  // 1. Build all packages
  console.log('[release:build] Compiling monorepo packages...');
  const buildRes = spawnSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true
  });
  if (buildRes.status !== 0) {
    throw new Error('pnpm build failed');
  }

  // 2. Build minified browser bundle dist-release/zoetrope.min.js
  console.log('[release:build] Bundling zoetrope.min.js (ESM)...');
  const { build: viteBuild } = await import('vite');
  await viteBuild({
    build: {
      lib: {
        entry: path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
        formats: ['es'],
        fileName: () => 'zoetrope.min.js'
      },
      outDir: distReleaseDir,
      emptyOutDir: false,
      minify: true,
      sourcemap: true
    }
  });

  // 3. Copy no-build HTML example
  const noBuildSrc = path.join(repoRoot, 'examples', 'no-build', 'index.html');
  const noBuildDest = path.join(distReleaseDir, 'no-build.html');
  if (fs.existsSync(noBuildSrc)) {
    fs.copyFileSync(noBuildSrc, noBuildDest);
  }

  // 4. Pack all packages into dist-release
  console.log('[release:build] Packing package tarballs into dist-release...');
  const packRes = spawnSync(
    'pnpm',
    ['-r', '--filter="./packages/*"', 'pack', '--pack-destination', 'dist-release'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true
    }
  );
  if (packRes.status !== 0) {
    throw new Error('pnpm pack failed');
  }

  // 5. Create skills.zip
  console.log('[release:build] Zipping skills into dist-release/skills.zip...');
  zipSkills(path.join(distReleaseDir, 'skills.zip'));

  // 6. Generate checksums.txt
  console.log('[release:build] Computing SHA-256 checksums...');
  const files = fs.readdirSync(distReleaseDir)
    .filter(f => f !== 'checksums.txt' && !f.endsWith('.map'));

  const checksumLines: string[] = [];
  for (const file of files.sort()) {
    const filePath = path.join(distReleaseDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    const data = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    checksumLines.push(`${hash}  ${file}`);
  }

  const checksumPath = path.join(distReleaseDir, 'checksums.txt');
  fs.writeFileSync(checksumPath, checksumLines.join('\n') + '\n', 'utf-8');

  console.log('\n================ DIST-RELEASE MANIFEST ================');
  for (const line of checksumLines) {
    const [h, file] = line.split(/\s+/);
    const stat = fs.statSync(path.join(distReleaseDir, file));
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  ${file.padEnd(42)} ${kb.padStart(8)} KB   SHA256: ${h.slice(0, 12)}...`);
  }
  console.log('========================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('build-release.ts')) {
  buildRelease().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
