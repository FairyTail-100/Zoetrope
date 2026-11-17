import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('Workspace Hygiene & Disk Conservations', () => {
  it('ensures .gitignore covers all temporary and artifact directories', () => {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('.artifacts/');
    expect(gitignore).toContain('test-results/');
    expect(gitignore).toContain('.tmp-*');
    expect(gitignore).toContain('dist/');
  });

  it('ensures no orphaned .tmp-* folders exist in the workspace', () => {
    const strayTmpDirs: string[] = [];
    function scan(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.pnpm-store' ||
          entry.name === 'fixtures'
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.name.startsWith('.tmp-')) {
          strayTmpDirs.push(full);
        } else if (entry.isDirectory()) {
          scan(full);
        }
      }
    }
    scan('.');
    expect(strayTmpDirs).toHaveLength(0);
  });

  it('ensures no video or image frame files are committed to git', () => {
    const trackedMedia = execSync('git ls-files "*.mp4" "*.mov" "*.webp" "*.png" "*.jpg"', { encoding: 'utf-8' }).trim();
    expect(trackedMedia).toBe('');
  });

  it('ensures no tracked config, doc, or TypeScript file starts with a UTF-8 BOM', () => {
    const files = execSync('git ls-files "*package.json" "*.json" "*.md" "*.yml" "*.ts"', { encoding: 'utf-8' })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);

    const bomFiles: string[] = [];
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const buf = fs.readFileSync(file);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        bomFiles.push(file);
      }
    }
    expect(bomFiles).toEqual([]);
  });
});
