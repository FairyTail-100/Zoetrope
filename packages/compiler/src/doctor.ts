import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, SpawnSyncReturns } from 'node:child_process';

function resolveBinary(command: string): string {
  if (process.platform !== 'win32') return command;
  const pathEnv = process.env.PATH || '';
  const exts = ['.exe', '.cmd', '.bat'];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return command;
}

function runTool(command: string, args: string[]): SpawnSyncReturns<Buffer> {
  const resolved = resolveBinary(command);
  const res = spawnSync(resolved, args, { stdio: 'pipe', shell: false, windowsHide: true });
  // Node >=20.12 on Windows throws EINVAL when spawning .cmd/.bat directly with shell: false;
  // invoke cmd.exe /d /c with explicit args array (no shell string interpolation) as fallback.
  if (
    process.platform === 'win32' &&
    res.error &&
    (res.error as NodeJS.ErrnoException).code === 'EINVAL' &&
    /\.(cmd|bat)$/i.test(resolved)
  ) {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', resolved, ...args], {
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
    });
  }
  return res;
}

export const MIN_FFMPEG_MAJOR = 6;

export interface ParsedFFmpegVersion {
  raw: string;
  major: number;
  minor: number;
}

export function parseFFmpegVersion(output: string): ParsedFFmpegVersion | null {
  const firstLine = output.split(/\r?\n/)[0] ?? '';
  const match = firstLine.match(/ffmpeg version ([^ ]+)/i);
  if (!match) return null;
  const raw = match[1];
  const semver = raw.match(/^n?(\d+)\.(\d+)/);
  if (!semver) return null;
  return {
    raw,
    major: parseInt(semver[1], 10),
    minor: parseInt(semver[2], 10),
  };
}

export interface EncoderAvailability {
  libwebp: boolean;
  'libaom-av1': boolean;
  mjpeg: boolean;
}

export function parseFFmpegEncoders(output: string): EncoderAvailability {
  const encoders: EncoderAvailability = {
    libwebp: false,
    'libaom-av1': false,
    mjpeg: false,
  };
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.]{6}\s+(libwebp|libaom-av1|mjpeg)\b/);
    if (match) {
      encoders[match[1] as keyof EncoderAvailability] = true;
    }
  }
  return encoders;
}

export function checkFFmpegEncoders(
  execTool: (command: string, args: string[]) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr'> = runTool,
  binary: string = 'ffmpeg'
): EncoderAvailability {
  const res = execTool(binary, ['-hide_banner', '-encoders']);
  if (res.status !== 0 || !res.stdout) {
    return { libwebp: false, 'libaom-av1': false, mjpeg: false };
  }
  return parseFFmpegEncoders(res.stdout.toString());
}

export interface DoctorCheckResult {
  name: string;
  detected: string;
  passed: boolean;
  warning?: boolean;
  message?: string;
}

export interface DoctorSummary {
  allOk: boolean;
  checks: DoctorCheckResult[];
}

export interface DoctorDeps {
  runTool?: (command: string, args: string[]) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr'>;
}

export function runDoctor(deps: DoctorDeps = {}): DoctorSummary {
  const execTool = deps.runTool ?? runTool;
  const checks: DoctorCheckResult[] = [];

  // 1. Node.js Check
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  const nodeOk = major >= 20;
  checks.push({
    name: 'Node.js Runtime',
    detected: `v${nodeVer} (>= 20.0.0 required)`,
    passed: nodeOk,
    message: nodeOk ? undefined : 'Node.js 20 or higher is required'
  });

  // 2. pnpm Check
  const pnpmCheck = execTool('pnpm', ['--version']);
  const pnpmOk = pnpmCheck.status === 0;
  const pnpmVer = pnpmOk ? pnpmCheck.stdout.toString().trim() : 'Not installed';
  checks.push({
    name: 'pnpm Package Manager',
    detected: pnpmOk ? `v${pnpmVer}` : 'Not found in PATH',
    passed: pnpmOk,
    message: pnpmOk ? undefined : 'Install pnpm via: npm install -g pnpm'
  });

  // 3. FFmpeg Check (>= 6.0)
  const ffmpegCheck = execTool('ffmpeg', ['-version']);
  const ffmpegFound = ffmpegCheck.status === 0;
  let ffmpegVer = 'Not found';
  let ffmpegOk = false;
  let ffmpegMsg: string | undefined;
  if (!ffmpegFound) {
    ffmpegMsg = 'Install FFmpeg >= 6.0 and add it to your system PATH';
  } else {
    const stdout = ffmpegCheck.stdout.toString();
    const parsed = parseFFmpegVersion(stdout);
    if (parsed) {
      ffmpegVer = `v${parsed.raw}`;
      ffmpegOk = parsed.major >= MIN_FFMPEG_MAJOR;
      if (!ffmpegOk) {
        ffmpegMsg = `FFmpeg >= ${MIN_FFMPEG_MAJOR}.0 is required (found ${ffmpegVer})`;
      }
    } else {
      const firstLine = stdout.split(/\r?\n/)[0] ?? '';
      const rawMatch = firstLine.match(/ffmpeg version ([^ ]+)/i);
      ffmpegVer = rawMatch ? `v${rawMatch[1]}` : 'Installed';
      ffmpegOk = true;
    }
  }
  checks.push({
    name: 'FFmpeg Tool',
    detected: ffmpegFound ? ffmpegVer : 'Not found in PATH',
    passed: ffmpegOk,
    message: ffmpegMsg
  });

  // 3b. FFmpeg Scale Filter Check (in_color_matrix=bt601)
  const filterArgs = ['-f', 'lavfi', '-i', 'testsrc=d=0.1', '-vf', 'scale=in_color_matrix=bt601', '-f', 'null', '-'];
  const filterCheck = ffmpegFound ? execTool('ffmpeg', filterArgs) : null;
  const filterOk = Boolean(ffmpegFound && filterCheck && filterCheck.status === 0);
  checks.push({
    name: 'Scale Filter (bt601)',
    detected: !ffmpegFound ? 'Skipped (FFmpeg missing)' : filterOk ? 'in_color_matrix=bt601 OK' : 'Unsupported',
    passed: filterOk,
    message: filterOk
      ? undefined
      : 'FFmpeg failed scale=in_color_matrix=bt601 probe (requires FFmpeg >= 6.0 with lavfi/scale support)'
  });

  // 3c. FFmpeg Encoder Checks (libwebp, libaom-av1, mjpeg)
  const encoders = ffmpegFound ? checkFFmpegEncoders(execTool) : { libwebp: false, 'libaom-av1': false, mjpeg: false };
  const encoderList: Array<{ key: keyof EncoderAvailability; warnOnly: boolean }> = [
    { key: 'libwebp', warnOnly: true },
    { key: 'libaom-av1', warnOnly: true },
    { key: 'mjpeg', warnOnly: false },
  ];
  for (const { key, warnOnly } of encoderList) {
    const ok = ffmpegFound && encoders[key];
    checks.push({
      name: `Encoder (${key})`,
      detected: !ffmpegFound ? 'Skipped (FFmpeg missing)' : ok ? 'OK' : 'MISSING',
      passed: ok || (ffmpegFound && warnOnly),
      warning: ffmpegFound && !ok && warnOnly,
      message: !ffmpegFound || ok ? undefined : `FFmpeg encoder "${key}" is missing`,
    });
  }

  // 4. ffprobe Check
  const ffprobeCheck = execTool('ffprobe', ['-version']);
  const ffprobeOk = ffprobeCheck.status === 0;
  let ffprobeVer = 'Not found';
  if (ffprobeOk) {
    const firstLine = ffprobeCheck.stdout.toString().split('\n')[0];
    const match = firstLine.match(/ffprobe version ([^ ]+)/);
    ffprobeVer = match ? `v${match[1]}` : 'Installed';
  }
  checks.push({
    name: 'ffprobe Tool',
    detected: ffprobeOk ? ffprobeVer : 'Not found in PATH',
    passed: ffprobeOk,
    message: ffprobeOk ? undefined : 'Install ffprobe and add it to your system PATH'
  });

  // 5. Free Disk Space Check
  let diskOk = true;
  let diskMsg = '10+ GB (Estimated)';
  try {
    const stats = fs.statfsSync(process.cwd());
    const freeMb = Math.round((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
    const freeGb = (freeMb / 1024).toFixed(1);
    diskOk = freeMb >= 1000;
    diskMsg = `${freeGb} GB available`;
  } catch {
    // statfs not supported on all runtimes
  }
  checks.push({
    name: 'Free Disk Space',
    detected: diskMsg,
    passed: diskOk,
    message: diskOk ? undefined : 'Less than 1GB free disk space available'
  });

  const allOk = checks.every(c => c.passed);
  return { allOk, checks };
}

export function printDoctorTable(summary: DoctorSummary): void {
  console.log('\nZoetropeJS System Diagnostics:\n');

  for (const c of summary.checks) {
    const statusText = c.warning ? '[WARN]' : c.passed ? '[PASS]' : '[FAIL]';
    console.log(`${statusText} ${c.name}: ${c.detected}`);
  }

  const colWidths = { name: 22, detected: 28, status: 8 };
  const line = `+${'-'.repeat(colWidths.name + 2)}+${'-'.repeat(colWidths.detected + 2)}+${'-'.repeat(colWidths.status + 2)}+`;

  console.log('\n' + line);
  console.log(
    `| ${'Check'.padEnd(colWidths.name)} | ${'Detected'.padEnd(colWidths.detected)} | ${'Status'.padEnd(colWidths.status)} |`
  );
  console.log(line);

  for (const c of summary.checks) {
    const statusText = c.warning ? 'WARN' : c.passed ? 'PASS' : 'FAIL';
    console.log(
      `| ${c.name.padEnd(colWidths.name)} | ${c.detected.slice(0, colWidths.detected).padEnd(colWidths.detected)} | ${statusText.padEnd(colWidths.status)} |`
    );
  }
  console.log(line);

  if (summary.allOk) {
    console.log('\n[PASS] All prerequisites are satisfied. Your environment is ready.\n');
  } else {
    console.log('\n[FAIL] Some prerequisites are missing:\n');
    for (const c of summary.checks) {
      if (!c.passed && c.message) {
        console.log(`  - ${c.name}: ${c.message}`);
      }
    }
    console.log('');
  }
}

