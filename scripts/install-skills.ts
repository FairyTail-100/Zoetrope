import fs from 'node:fs';
import path from 'node:path';

export interface InstallSkillsOptions {
  force?: boolean;
}

export interface InstallSkillsResult {
  dest: string;
  copied: string[];
  skipped: string[];
}

function copyDirSafe(
  src: string,
  dest: string,
  relPrefix: string,
  force: boolean,
  copied: string[],
  skipped: string[]
) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.join(relPrefix, entry.name);

    if (entry.isDirectory()) {
      copyDirSafe(srcPath, destPath, relPath, force, copied, skipped);
    } else if (fs.existsSync(destPath) && !force) {
      skipped.push(relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      copied.push(relPath);
    }
  }
}

export function installSkillsWithReport(
  targetDir?: string,
  options?: InstallSkillsOptions
): InstallSkillsResult {
  const dest = path.resolve(targetDir || path.join(process.cwd(), '.agents', 'skills'));
  const sourceSkillsDir = path.resolve(path.join(import.meta.dirname, '..', 'skills'));
  const force = options?.force ?? false;

  if (!fs.existsSync(sourceSkillsDir)) {
    throw new Error(`Skills source directory not found: ${sourceSkillsDir}`);
  }

  fs.mkdirSync(dest, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];

  const topEntries = fs.readdirSync(sourceSkillsDir, { withFileTypes: true });
  for (const entry of topEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith('zoetrope-')) {
      continue;
    }
    copyDirSafe(
      path.join(sourceSkillsDir, entry.name),
      path.join(dest, entry.name),
      entry.name,
      force,
      copied,
      skipped
    );
  }

  for (const rel of copied) {
    console.log(`  copied:  ${rel}`);
  }
  for (const rel of skipped) {
    console.log(`  skipped: ${rel} (already exists; pass --force to overwrite)`);
  }

  return { dest, copied, skipped };
}

export function installSkills(targetDir?: string, options?: InstallSkillsOptions): string {
  return installSkillsWithReport(targetDir, options).dest;
}

if (process.argv[1] && process.argv[1].endsWith('install-skills.ts')) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const target = args.find((a) => !a.startsWith('--'));
  const result = installSkillsWithReport(target, { force });
  console.log(
    `Installed Zoetrope skills to ${result.dest} (${result.copied.length} copied, ${result.skipped.length} skipped)`
  );
}
