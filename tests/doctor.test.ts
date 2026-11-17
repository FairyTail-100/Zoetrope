import { describe, it, expect } from 'vitest';
import { runDoctor } from '../packages/compiler/src/doctor.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('Zoetrope Doctor CLI & Diagnostics', () => {
  it('runDoctor returns structured checks with passing status on current system', () => {
    const summary = runDoctor();
    expect(summary.checks.length).toBeGreaterThanOrEqual(4);

    const nodeCheck = summary.checks.find(c => c.name.includes('Node'));
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.passed).toBe(true);

    const pnpmCheck = summary.checks.find(c => c.name.includes('pnpm'));
    expect(pnpmCheck).toBeDefined();
    expect(pnpmCheck?.passed).toBe(true);

    const ffmpegCheck = summary.checks.find(c => c.name.includes('FFmpeg'));
    expect(ffmpegCheck).toBeDefined();
    expect(ffmpegCheck?.passed).toBe(true);

    const ffprobeCheck = summary.checks.find(c => c.name.includes('ffprobe'));
    expect(ffprobeCheck).toBeDefined();
    expect(ffprobeCheck?.passed).toBe(true);

    const diskCheck = summary.checks.find(c => c.name.includes('Disk'));
    expect(diskCheck).toBeDefined();
    expect(diskCheck?.passed).toBe(true);

    expect(summary.allOk).toBe(true);
  });

  it('runs zoetrope doctor via CLI and exits with code 0', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const res = spawnSync('pnpm', ['zoetrope', 'doctor'], {
      cwd: repoRoot,
      stdio: 'pipe',
      shell: true
    });

    expect(res.status).toBe(0);
    const output = res.stdout.toString();
    expect(output).toContain('Zoetrope System Diagnostics');
    expect(output).toContain('PASS');
    expect(output).toContain('[PASS] All prerequisites are satisfied');
  });
});

