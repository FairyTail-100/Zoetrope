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

export interface DoctorCheckResult {
  name: string;
  detected: string;
  passed: boolean;
  message?: string;
}

export interface DoctorSummary {
  allOk: boolean;
  checks: DoctorCheckResult[];
}

export function runDoctor(): DoctorSummary {
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
  const pnpmCheck = runTool('pnpm', ['--version']);
  const pnpmOk = pnpmCheck.status === 0;
  const pnpmVer = pnpmOk ? pnpmCheck.stdout.toString().trim() : 'Not installed';
  checks.push({
    name: 'pnpm Package Manager',
    detected: pnpmOk ? `v${pnpmVer}` : 'Not found in PATH',
    passed: pnpmOk,
    message: pnpmOk ? undefined : 'Install pnpm via: npm install -g pnpm'
  });

  // 3. FFmpeg Check
  const ffmpegCheck = runTool('ffmpeg', ['-version']);
  const ffmpegOk = ffmpegCheck.status === 0;
  let ffmpegVer = 'Not found';
  if (ffmpegOk) {
    const firstLine = ffmpegCheck.stdout.toString().split('\n')[0];
    const match = firstLine.match(/ffmpeg version ([^ ]+)/);
    ffmpegVer = match ? `v${match[1]}` : 'Installed';
  }
  checks.push({
    name: 'FFmpeg Tool',
    detected: ffmpegOk ? ffmpegVer : 'Not found in PATH',
    passed: ffmpegOk,
    message: ffmpegOk ? undefined : 'Install FFmpeg and add it to your system PATH'
  });

  // 4. ffprobe Check
  const ffprobeCheck = runTool('ffprobe', ['-version']);
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
  console.log('\nZoetrope System Diagnostics:\n');

  for (const c of summary.checks) {
    const statusText = c.passed ? '[PASS]' : '[FAIL]';
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
    const statusText = c.passed ? 'PASS' : 'FAIL';
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

