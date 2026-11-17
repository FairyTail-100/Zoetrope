import * as fs from 'node:fs';
import * as path from 'node:path';

const isDeep = process.argv.includes('--deep');

function removeTarget(target: string) {
  try {
    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.unlinkSync(target);
      }
      console.log(`Removed: ${target}`);
    }
  } catch (err) {
    console.warn(`Could not remove ${target}:`, err);
  }
}

// 1. Unified artifacts and test results
removeTarget('.artifacts');
removeTarget('test-results');
removeTarget('playwright-report');
removeTarget('tests/fixtures');
removeTarget('benchmarks/assets');

// 2. Build outputs across packages and examples
removeTarget('benchmarks/engine.bundle.js');
removeTarget('examples/basic-scroll/dist');
removeTarget('examples/layered-composition/dist');
removeTarget('examples/astro/dist');
removeTarget('examples/astro/.astro');
removeTarget('examples/nextjs/.next');

const packagesDir = path.resolve('packages');
if (fs.existsSync(packagesDir)) {
  for (const pkg of fs.readdirSync(packagesDir)) {
    removeTarget(path.join(packagesDir, pkg, 'dist'));
  }
}

// 3. Deep clean: dependencies and stores
if (isDeep) {
  removeTarget('node_modules');
  removeTarget('.pnpm-store');
  const examplesDir = path.resolve('examples');
  if (fs.existsSync(examplesDir)) {
    for (const ex of fs.readdirSync(examplesDir)) {
      removeTarget(path.join(examplesDir, ex, 'node_modules'));
    }
  }
}

console.log(`Clean complete${isDeep ? ' (deep)' : ''}.`);

