import fs from 'node:fs';
import path from 'node:path';

export function checkVersions(): { success: boolean; version: string; mismatches: string[] } {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const rootPkgPath = path.join(repoRoot, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));

  const expectedVersion = rootPkg.version;
  const mismatches: string[] = [];

  if (rootPkg.name !== 'zoetropejs-monorepo') {
    mismatches.push(`root package.json name must be "zoetropejs-monorepo", found "${rootPkg.name}"`);
  }

  const packagesDir = path.join(repoRoot, 'packages');
  const packageFolders = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const folder of packageFolders) {
    const pkgPath = path.join(packagesDir, folder, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.version !== expectedVersion) {
      mismatches.push(`packages/${folder}/package.json has version "${pkg.version}", expected "${expectedVersion}"`);
    }
  }

  return {
    success: mismatches.length === 0,
    version: expectedVersion,
    mismatches
  };
}

if (process.argv[1] && process.argv[1].endsWith('check-version.ts')) {
  const result = checkVersions();
  if (!result.success) {
    console.error('Version check failed:\n' + result.mismatches.join('\n'));
    process.exit(1);
  }
  console.log(`Version check passed: all packages match version "${result.version}"`);
}

