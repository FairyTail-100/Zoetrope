---
name: zoetrope-compile-video
description: Compiling source videos into frame sequences, variants, and manifests. Use when transcoding video files, configuring compilation flags, or estimating output size.
---

# Video Compilation Pipeline

The Zoetrope Compiler converts video files into deterministic, responsive image sequences with a unified `manifest.json`.

## Quick Start Command

From the repository root:
```bash
pnpm zoetrope compile video.mp4 --out public/assets/hero --fps 24
```

To compile a slice of a video:
```bash
pnpm zoetrope compile raw.mp4 --out public/assets/hero --start 2.0 --end 10.0 --fps 24
```

## Compilation Flags & Defaults

- `--fps <n>`: Frame rate (default: video source FPS). Units: frames per second.
- `--start <sec>` / `--end <sec>`: Temporal slicing offsets in decimal seconds.
- `--formats <formats>`: Output image formats (default: `webp`). AVIF is opt-in (`--formats avif,webp`).
- `--force`: Bypass `.build-cache.json` and force full frame re-extraction.
- `--yes`: Auto-confirm the Disk Safety Guard if estimated output >500MB or disk space is tight.

## Output Layout

Compilation outputs an atomic layout:
```text
<output-dir>/
├── manifest.json         # Master metadata, variant definitions, and frame indices
├── .build-cache.json     # Content hash for cache-skipping on identical runs
├── desktop/              # desktop variant frames (1920x1080)
│   ├── frame_0001.webp
│   └── ...
└── mobile/               # mobile variant frames (640x360)
    ├── frame_0001.webp
    └── ...
```

## Disk Guard & Preflight Verification

Before running large compiles, use the preflight script to estimate disk requirements:
```bash
pnpm tsx skills/zoetrope-compile-video/scripts/preflight.ts video.mp4 ./output
```

If the compilation exceeds 500MB or free disk space is less than 2x estimated size, the compiler requires `--yes` to proceed.

## Detailed Reference

For custom variant overrides and motion LUT extraction:
👉 [references/cli-options.md](references/cli-options.md)

