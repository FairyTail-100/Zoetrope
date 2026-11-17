import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function zipSkills(destPath?: string): string {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const targetZip = destPath ? path.resolve(destPath) : path.join(repoRoot, 'dist-release', 'skills.zip');
  const skillsDir = path.join(repoRoot, 'skills');

  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  fs.mkdirSync(path.dirname(targetZip), { recursive: true });
  if (fs.existsSync(targetZip)) {
    fs.unlinkSync(targetZip);
  }

  // Use tar -a on Windows/Linux or powershell fallback
  const res = spawnSync('tar', ['-a', '-cf', targetZip, 'skills'], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  if (res.status !== 0) {
    // Fallback to powershell Compress-Archive on Windows
    const psRes = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${skillsDir}" -DestinationPath "${targetZip}" -Force`
    ], { stdio: 'pipe' });

    if (psRes.status !== 0) {
      throw new Error(`Failed to create skills zip archive: ${res.stderr?.toString() || psRes.stderr?.toString()}`);
    }
  }

  return targetZip;
}

if (process.argv[1] && process.argv[1].endsWith('zip-skills.ts')) {
  const out = zipSkills(process.argv[2]);
  console.log(`Created skills archive at: ${out}`);
}

