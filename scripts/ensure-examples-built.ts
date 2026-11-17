import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureShowcaseAssets } from './ensure-showcase-assets.js';

export async function ensureExamplesBuilt(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, '..');

  // Ensure showcase assets once before starting example builds
  await ensureShowcaseAssets();
  const showcaseTargets = [
    'examples/basic-scroll/public/assets/showcase',
    'examples/layered-composition/public/assets/showcase',
    'examples/nextjs/public/assets/showcase',
    'examples/astro/public/assets/showcase',
  ];
  for (const t of showcaseTargets) {
    await ensureShowcaseAssets(path.join(repoRoot, t));
  }

  const examples = [
    'example-basic-scroll',
    'example-layered-composition',
    'example-nextjs',
    'example-astro',
  ];

  console.log(`[ensure-examples-built] Building examples (${examples.join(', ')})...`);
  for (const name of examples) {
    const res = spawnSync('pnpm', ['--filter', name, 'run', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true
    });
    if (res.status !== 0) {
      throw new Error(`Failed to build ${name} before running e2e tests.`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('ensure-examples-built.ts')) {
  ensureExamplesBuilt().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

