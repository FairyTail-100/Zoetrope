import { describe, it, expect } from 'vitest';
import { runDoctor, parseFFmpegVersion } from '../packages/compiler/src/doctor.js';
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

  it('runs zoetropejs  via CLI and exits with code 0', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const res = spawnSync('pnpm', ['zoetrope', 'doctor'], {
      cwd: repoRoot,
      stdio: 'pipe',
      shell: true
    });

    expect(res.status).toBe(0);
    const output = res.stdout.toString();
    expect(output).toContain('ZoetropeJS System Diagnostics');
    expect(output).toContain('PASS');
    expect(output).toContain('[PASS] All prerequisites are satisfied');
  });

  it('parseFFmpegVersion parses standard and n-prefixed versions', () => {
    expect(parseFFmpegVersion('ffmpeg version 9.0.1-essentials_build-www.gyan.dev Copyright')).toEqual({
      raw: '9.0.1-essentials_build-www.gyan.dev',
      major: 9,
      minor: 0,
    });
    expect(parseFFmpegVersion('ffmpeg version 5.1.4-0ubuntu0.22.04.1 Copyright')).toEqual({
      raw: '5.1.4-0ubuntu0.22.04.1',
      major: 5,
      minor: 1,
    });
    expect(parseFFmpegVersion('ffmpeg version n6.1.1-1-gabcdef')).toEqual({
      raw: 'n6.1.1-1-gabcdef',
      major: 6,
      minor: 1,
    });
  });

  it('fails when FFmpeg version is below 6.0', () => {
    const summary = runDoctor({
      runTool: (cmd, args) => {
        if (cmd === 'ffmpeg' && args[0] === '-version') {
          return { status: 0, stdout: Buffer.from('ffmpeg version 5.1.4-0ubuntu0.22.04.1\n'), stderr: Buffer.alloc(0) };
        }
        return { status: 0, stdout: Buffer.from('6.0.0\n'), stderr: Buffer.alloc(0) };
      },
    });
    const ffmpegCheck = summary.checks.find(c => c.name === 'FFmpeg Tool');
    expect(ffmpegCheck?.passed).toBe(false);
    expect(ffmpegCheck?.message).toContain('FFmpeg >= 6.0 is required');
    expect(summary.allOk).toBe(false);
  });

  it('fails when scale=in_color_matrix=bt601 probe fails', () => {
    const summary = runDoctor({
      runTool: (cmd, args) => {
        if (cmd === 'ffmpeg' && args[0] === '-version') {
          return { status: 0, stdout: Buffer.from('ffmpeg version 6.0\n'), stderr: Buffer.alloc(0) };
        }
        if (cmd === 'ffmpeg' && args.includes('scale=in_color_matrix=bt601')) {
          return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('Invalid value') };
        }
        return { status: 0, stdout: Buffer.from('10.0.0\n'), stderr: Buffer.alloc(0) };
      },
    });
    const filterCheck = summary.checks.find(c => c.name.includes('Scale Filter'));
    expect(filterCheck?.passed).toBe(false);
    expect(filterCheck?.message).toContain('scale=in_color_matrix=bt601');
    expect(summary.allOk).toBe(false);
  });
});

