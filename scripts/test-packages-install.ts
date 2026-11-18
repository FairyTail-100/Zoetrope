import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runCmd(cmd: string, cwd: string, allowFail = false): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, { cwd, stdio: 'pipe', shell: true, encoding: 'utf-8' });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  const status = res.status ?? 1;
  if (!allowFail && status !== 0) {
    throw new Error(`Command failed (${status}): ${cmd}`);
  }
  return { status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function verifyNpmPackDryRun(pkgDir: string, pkgLabel: string): void {
  console.log(`\n[test:packages] Running npm pack --dry-run --json in ${pkgLabel}...`);
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    stdio: 'pipe',
    shell: true,
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`[test:packages] npm pack --dry-run failed in ${pkgLabel}: ${res.stderr}`);
  }
  const parsed = JSON.parse(res.stdout) as any;
  const entry = Array.isArray(parsed)
    ? parsed[0]
    : parsed.files
      ? parsed
      : (Object.values(parsed)[0] as { files: Array<{ path: string }> });
  const filePaths = entry.files.map((f: { path: string }) => f.path);
  console.log(`[test:packages] ${pkgLabel} tarball files (${filePaths.length}):`);
  for (const fp of filePaths) {
    console.log(`  - ${fp}`);
  }

  for (const fp of filePaths) {
    if (fp.startsWith('src/') || fp.startsWith('tests/') || /tsconfig/i.test(fp)) {
      throw new Error(`[test:packages] ${pkgLabel} tarball contains forbidden file: ${fp}`);
    }
  }
  if (!filePaths.includes('LICENSE')) {
    throw new Error(`[test:packages] ${pkgLabel} tarball is missing LICENSE`);
  }
  if (!filePaths.includes('README.md')) {
    throw new Error(`[test:packages] ${pkgLabel} tarball is missing README.md`);
  }
  if (!filePaths.some((fp) => fp.startsWith('dist/'))) {
    throw new Error(`[test:packages] ${pkgLabel} tarball is missing dist/ files`);
  }
}

function verifyPackedManifestNoWorkspaceSpecifiers(tarballPath: string, pkgLabel: string): void {
  const res = spawnSync('tar', ['-xOzf', tarballPath, 'package/package.json'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`[test:packages] Failed to extract package/package.json from ${tarballPath}: ${res.stderr}`);
  }
  const pkg = JSON.parse(res.stdout) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const map = pkg[field];
    if (!map) continue;
    for (const [dep, spec] of Object.entries(map)) {
      if (typeof spec === 'string' && spec.includes('workspace:')) {
        throw new Error(
          `[test:packages] ${pkgLabel} packed package.json has unresolved "${spec}" in ${field}.${dep}`
        );
      }
    }
  }

  if (pkgLabel === '@zoetropejs/react') {
    console.log(`[test:packages] Packed ${pkgLabel} dependencies:`, JSON.stringify(pkg.dependencies ?? {}));
  }
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function runPackagesInstallSmokeTest(): void {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const version = rootPkg.version;
  const distReleaseDir = path.join(repoRoot, 'dist-release');
  const tscBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

  // 0. Verify bundled dist/index.js for core and compiler have no @zoetropejs/ imports
  for (const name of ['core', 'compiler']) {
    const bundlePath = path.join(repoRoot, 'packages', name, 'dist', 'index.js');
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`[test:packages] Missing bundle: ${bundlePath}`);
    }
    const content = fs.readFileSync(bundlePath, 'utf-8');
    if (/from\s+['"]@zoetrope\/|import\s*\(\s*['"]@zoetrope\/|@zoetrope\//.test(content)) {
      throw new Error(`[test:packages] ${bundlePath} contains an unbundled @zoetropejs/ import`);
    }
  }

  // 0b. Verify npm pack --dry-run --json for all 3 public packages
  for (const name of ['core', 'compiler', 'react']) {
    verifyNpmPackDryRun(path.join(repoRoot, 'packages', name), `@zoetropejs/${name}`);
  }

  const coreTarball = path.join(distReleaseDir, `zoetropejs-core-${version}.tgz`);
  const compilerTarball = path.join(distReleaseDir, `zoetropejs-compiler-${version}.tgz`);
  const reactTarball = path.join(distReleaseDir, `zoetropejs-react-${version}.tgz`);

  if (!fs.existsSync(coreTarball) || !fs.existsSync(compilerTarball) || !fs.existsSync(reactTarball)) {
    console.log('[test:packages] Missing tarballs in dist-release/, running pnpm pack:all...');
    runCmd('pnpm pack:all', repoRoot);
  }

  verifyPackedManifestNoWorkspaceSpecifiers(coreTarball, '@zoetropejs/core');
  verifyPackedManifestNoWorkspaceSpecifiers(compilerTarball, '@zoetropejs/compiler');
  verifyPackedManifestNoWorkspaceSpecifiers(reactTarball, '@zoetropejs/react');

  // (a) Standalone @zoetropejs/core
  const coreDir = makeTempDir('zoetrope-test-core-');
  try {
    console.log(`\n[test:packages] (a) Testing @zoetropejs/core alone in ${coreDir}`);
    fs.writeFileSync(
      path.join(coreDir, 'package.json'),
      JSON.stringify({ name: 'test-core-alone', version: '1.0.0', type: 'module' }, null, 2)
    );
    runCmd(`pnpm add "${coreTarball}" --ignore-workspace`, coreDir);
    fs.writeFileSync(
      path.join(coreDir, 'verify.mjs'),
      `import { Zoetrope, ZoetropeComposition } from '@zoetropejs/core';
if (typeof Zoetrope !== 'function' || typeof ZoetropeComposition !== 'function') throw new Error('Missing exports');
console.log('[test:packages] (a) runtime OK');
`
    );
    runCmd('node verify.mjs', coreDir);
    fs.writeFileSync(
      path.join(coreDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true },
        include: ['verify.ts'],
      })
    );
    fs.writeFileSync(
      path.join(coreDir, 'verify.ts'),
      `import { Zoetrope, ZoetropeComposition, type ZoetropeOptions } from '@zoetropejs/core';
export function check(canvas: HTMLCanvasElement) {
  const opts: ZoetropeOptions = { canvas, manifest: '/manifest.json' };
  return { a: new Zoetrope(opts), b: new ZoetropeComposition({ canvas, layers: [] }) };
}
`
    );
    runCmd(`"${tscBin}" --noEmit`, coreDir);
    console.log('[test:packages] (a) @zoetropejs/core standalone runtime + tsc --noEmit PASSED');
  } finally {
    fs.rmSync(coreDir, { recursive: true, force: true });
  }

  // (b) Standalone @zoetropejs/compiler
  const compilerDir = makeTempDir('zoetrope-test-compiler-');
  try {
    console.log(`\n[test:packages] (b) Testing @zoetropejs/compiler alone in ${compilerDir}`);
    fs.writeFileSync(
      path.join(compilerDir, 'package.json'),
      JSON.stringify({ name: 'test-compiler-alone', version: '1.0.0', type: 'module' }, null, 2)
    );
    runCmd(`pnpm add "${compilerTarball}" --ignore-workspace`, compilerDir);
    runCmd('npx zoetropejs --help', compilerDir);
    const docRes = runCmd('npx zoetropejs doctor', compilerDir, true);
    console.log(`[test:packages] (b) zoetropejs  exited with code ${docRes.status}`);
    console.log('[test:packages] (b) @zoetropejs/compiler standalone CLI PASSED');
  } finally {
    fs.rmSync(compilerDir, { recursive: true, force: true });
  }

  // (c) @zoetropejs/core + @zoetropejs/react + react + react-dom
  const reactDir = makeTempDir('zoetrope-test-react-');
  try {
    console.log(`\n[test:packages] (c) Testing @zoetropejs/core + @zoetropejs/react in ${reactDir}`);
    fs.writeFileSync(
      path.join(reactDir, 'package.json'),
      JSON.stringify({ name: 'test-react-alone', version: '1.0.0', type: 'module' }, null, 2)
    );
    fs.writeFileSync(
      path.join(reactDir, 'pnpm-workspace.yaml'),
      `overrides:\n  "@zoetropejs/core": "file:${coreTarball.replace(/\\/g, '/')}"\n`
    );
    runCmd(`pnpm add "${coreTarball}" "${reactTarball}" react@19.3.1 react-dom@19.3.1 @types/react@19.3.0`, reactDir);
    fs.writeFileSync(
      path.join(reactDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
        },
        include: ['verify.tsx'],
      })
    );
    fs.writeFileSync(
      path.join(reactDir, 'verify.tsx'),
      `import { ZoetropeCanvas, NextZoetropePlayer, useZoetrope } from '@zoetropejs/react';
export function Demo() {
  const { canvasRef } = useZoetrope({ manifest: '/manifest.json' });
  return (
    <>
      <ZoetropeCanvas canvasRef={canvasRef} />
      <NextZoetropePlayer options={{ manifest: '/manifest.json' }} />
    </>
  );
}
`
    );
    runCmd(`"${tscBin}" --noEmit`, reactDir);
    console.log('[test:packages] (c) @zoetropejs/react + @zoetropejs/core tsc --noEmit PASSED');
  } finally {
    fs.rmSync(reactDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('test-packages-install.ts')) {
  try {
    runPackagesInstallSmokeTest();
    console.log('\n[test:packages] All standalone package install tests PASSED.');
  } catch (err: any) {
    console.error(err?.message || err);
    process.exit(1);
  }
}
