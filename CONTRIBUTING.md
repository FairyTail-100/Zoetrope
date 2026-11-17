# Contributing to Zoetrope

Issues and pull requests are welcome at https://github.com/FairyTail-100/Zoetrope.

## Prerequisites

- Node.js `>= 20`
- `pnpm`
- `ffmpeg` and `ffprobe` on `PATH`

## Local Setup

```bash
pnpm install
pnpm build
```

## Required Checks Before Opening a PR

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:skills
```

For changes affecting packaging or standalone consumption, also run:

```bash
pnpm pack:all
pnpm test:core-install
```

Please keep commits focused (one logical change per commit) using [Conventional Commits](https://www.conventionalcommits.org/).
