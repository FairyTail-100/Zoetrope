import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scaffoldProject } from '../scripts/new-project.js';
import { installSkills } from '../scripts/install-skills.js';
import { runPreflight } from '../skills/zoetrope-compile-video/scripts/preflight.js';

describe('Part 2 & 3: Agent Skills Specification & Verification', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const skillsDir = path.join(repoRoot, 'skills');

  const expectedSkills = [
    'zoetrope-engine',
    'zoetrope-compile-video',
    'zoetrope-integrate',
    'zoetrope-compose',
    'zoetrope-deploy-cloudflare',
    'zoetrope-troubleshoot',
    'zoetrope-new-project'
  ];

  it('contains exactly the 7 required skills with valid directories', () => {
    expect(fs.existsSync(skillsDir)).toBe(true);
    for (const skillName of expectedSkills) {
      const skillFolder = path.join(skillsDir, skillName);
      expect(fs.existsSync(skillFolder), `Missing skill folder: ${skillName}`).toBe(true);
      expect(fs.existsSync(path.join(skillFolder, 'SKILL.md')), `Missing SKILL.md in: ${skillName}`).toBe(true);
    }
  });

  it('validates YAML frontmatter, length (<150 lines), and relative links in every SKILL.md', () => {
    for (const skillName of expectedSkills) {
      const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');
      const lines = content.split('\n');

      expect(lines.length).toBeLessThan(150);

      // Verify frontmatter
      expect(content.startsWith('---')).toBe(true);
      const secondDashes = content.indexOf('---', 3);
      expect(secondDashes).toBeGreaterThan(3);
      const frontmatter = content.slice(3, secondDashes);

      const nameMatch = frontmatter.match(/name:\s*([a-zA-Z0-9_-]+)/);
      expect(nameMatch).toBeTruthy();
      expect(nameMatch![1].trim()).toBe(skillName);

      const descMatch = frontmatter.match(/description:\s*(.+)/);
      expect(descMatch).toBeTruthy();
      expect(descMatch![1].trim().length).toBeGreaterThan(10);

      // Check relative links: [text](path)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const targetPath = match[2].trim();
        // Skip web urls or file:// urls
        if (targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('file://')) {
          continue;
        }
        const resolved = path.resolve(path.join(skillsDir, skillName), targetPath);
        expect(fs.existsSync(resolved), `Broken link in ${skillName}/SKILL.md: ${targetPath}`).toBe(true);
      }
    }
  });

  it('verifies all scripts referenced in SKILL.md files exist on disk', () => {
    const scriptRegex = /(?:tsx|node)\s+([a-zA-Z0-9_\-./]+\.ts)/g;
    for (const skillName of expectedSkills) {
      const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');
      let m;
      while ((m = scriptRegex.exec(content)) !== null) {
        const scriptPath = m[1].trim();
        const resolved = path.resolve(repoRoot, scriptPath);
        expect(fs.existsSync(resolved), `Referenced script missing: ${scriptPath} in ${skillName}`).toBe(true);
      }
    }
  });

  it('runs preflight.ts against a tiny generated clip (0.5s, 160x90)', async () => {
    const artifactsDir = path.join(repoRoot, '.artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const clipPath = path.join(artifactsDir, 'tiny-preflight.mp4');
    const outDir = path.join(artifactsDir, 'tiny-preflight-out');

    try {
      // Generate <=1s 160x90 test clip
      spawnSync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', 'testsrc=duration=0.5:size=160x90:rate=24',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        clipPath
      ], { stdio: 'pipe' });

      expect(fs.existsSync(clipPath)).toBe(true);

      const report = await runPreflight(clipPath, outDir, 24);
      expect(report.ffmpegOk).toBe(true);
      expect(report.durationSec).toBeGreaterThan(0.4);
      expect(report.totalFrames).toBe(12);
      expect(report.recommendation).toBe('GO');
    } finally {
      if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
      if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('verifies AGENTS.md entrypoint points to valid zoetrope-engine/SKILL.md', () => {
    const agentsMdPath = path.join(repoRoot, 'AGENTS.md');
    expect(fs.existsSync(agentsMdPath)).toBe(true);
    const content = fs.readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('skills/zoetrope-engine/SKILL.md');
  });

  it('tests skills:install script copies skills directory', () => {
    const testDest = path.join(repoRoot, '.artifacts', 'test-skills-install');
    try {
      if (fs.existsSync(testDest)) fs.rmSync(testDest, { recursive: true, force: true });
      const installed = installSkills(testDest);
      expect(fs.existsSync(path.join(installed, 'zoetrope-engine', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(installed, 'README.md'))).toBe(false);
      expect(fs.existsSync(path.join(installed, 'INDEX.md'))).toBe(false);
    } finally {
      if (fs.existsSync(testDest)) fs.rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('validates skills against real CLI flags, repo paths, test files, and forbids stale drift strings', () => {
    const cliSource = fs.readFileSync(
      path.join(repoRoot, 'packages', 'compiler', 'src', 'cli.ts'),
      'utf-8'
    );
    const cliFlags = new Set<string>();
    const cliFlagRegex = /getArg\(['"](--?[a-zA-Z0-9-]+)['"]\)|hasFlag\(['"](--?[a-zA-Z0-9-]+)['"]\)|remainingArgs\[i\]\s*===\s*['"](--?[a-zA-Z0-9-]+)['"]/g;
    let flagMatch: RegExpExecArray | null;
    while ((flagMatch = cliFlagRegex.exec(cliSource)) !== null) {
      const f = flagMatch[1] || flagMatch[2] || flagMatch[3];
      if (f) cliFlags.add(f);
    }
    expect(cliFlags.size).toBeGreaterThan(5);

    const forbidden = ['rc10', 'frame_0000', '--pack-mode', 'sharedBudgetMb', 'onUpdate'];

    const skillFiles: string[] = [];
    for (const skillName of expectedSkills) {
      const skillFolder = path.join(skillsDir, skillName);
      skillFiles.push(path.join(skillFolder, 'SKILL.md'));
      const refsDir = path.join(skillFolder, 'references');
      if (fs.existsSync(refsDir)) {
        for (const f of fs.readdirSync(refsDir)) {
          if (f.endsWith('.md')) {
            skillFiles.push(path.join(refsDir, f));
          }
        }
      }
    }

    const repoRoots = ['packages/', 'skills/', 'scripts/', 'documentation/', 'examples/', 'tests/'];

    for (const filePath of skillFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const rel = path.relative(repoRoot, filePath);

      // (d) Forbidden stale drift strings
      for (const bad of forbidden) {
        expect(content, `${rel} contains forbidden stale string "${bad}"`).not.toContain(bad);
      }

      // (a) Extract flags from `zoetrope compile` usage and cli-options.md table
      const compileLines = content
        .split('\n')
        .filter((line) => line.includes('zoetrope compile') || (rel.endsWith('cli-options.md') && line.startsWith('| `--')));
      for (const line of compileLines) {
        const lineFlags = line.match(/--[a-z][a-z0-9-]*/g) ?? [];
        for (const f of lineFlags) {
          expect(cliFlags.has(f), `${rel} references unknown CLI flag "${f}"`).toBe(true);
        }
      }

      // (b) Assert every repo-relative path in backticks exists
      const backtickRegex = /`([^`\n]+)`/g;
      let btMatch: RegExpExecArray | null;
      while ((btMatch = backtickRegex.exec(content)) !== null) {
        const token = btMatch[1].trim();
        if (token.includes(' ') || token.includes('*') || token.includes('<')) continue;
        if (repoRoots.some((prefix) => token.startsWith(prefix))) {
          const resolved = path.resolve(repoRoot, token);
          expect(fs.existsSync(resolved), `${rel} references missing repo path \`${token}\``).toBe(true);
        }
      }

      // (c) Assert every tests/*.test.ts or tests/*.spec.ts mentioned exists
      const testPathRegex = /tests\/[a-zA-Z0-9_./-]+\.(?:test|spec)\.ts/g;
      let testMatch: RegExpExecArray | null;
      while ((testMatch = testPathRegex.exec(content)) !== null) {
        const testRel = testMatch[0];
        const resolved = path.resolve(repoRoot, testRel);
        expect(fs.existsSync(resolved), `${rel} references missing test file ${testRel}`).toBe(true);
      }
    }
  });

  it('scaffolds a new project without workspace:* dependencies', () => {
    const testProjectDir = path.join(repoRoot, '.artifacts', 'test-scaffold');
    try {
      if (fs.existsSync(testProjectDir)) fs.rmSync(testProjectDir, { recursive: true, force: true });

      scaffoldProject({
        targetDir: testProjectDir,
        projectName: 'scaffold-test-project'
      });

      expect(fs.existsSync(path.join(testProjectDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'pnpm-workspace.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, '.npmrc'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'vite.config.ts'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'src', 'main.ts'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'public', 'assets', 'demo', 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(testProjectDir, 'public', 'assets', 'demo', 'desktop', 'frame_0000.webp'))).toBe(true);

      const pkgRaw = fs.readFileSync(path.join(testProjectDir, 'package.json'), 'utf-8');
      expect(pkgRaw).not.toContain('workspace:');

      const pkg = JSON.parse(pkgRaw);
      expect(pkg.name).toBe('scaffold-test-project');
      expect(pkg.dependencies['@zoetropejs/core']).toMatch(/^file:\.\/vendor\//);
    } finally {
      if (fs.existsSync(testProjectDir)) fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });
});
