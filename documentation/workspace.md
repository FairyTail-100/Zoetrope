# Workspace Architecture & Hygiene Guide

This document outlines the repository layout, build and artifact routing rules, cache mechanics, disk conservation safeguards, and clean routines.

---

## 1. Directory Layout

The workspace is organized as a unified monorepo powered by `pnpm`:

```
custom-video-pipeline/
├── .artifacts/                 # Gitignored root for all generated outputs
│   ├── custom/<hash>/          # Compiled custom video sequences (latest N=2)
│   ├── bench/                  # On-demand benchmark sequences
│   ├── test-results/           # Playwright traces, failure screenshots, videos
│   └── playwright-report/      # Playwright HTML report
├── documentation/              # Architecture, feature status, workspace & deployment docs
├── examples/                   # Framework integration examples
│   ├── basic-scroll/           # Vanilla TypeScript scroll-driven showcase
│   ├── layered-composition/    # Multi-track compositor with iris masking
│   ├── nextjs/                 # Next.js 15 App Router React integration
│   └── astro/                  # Astro island component integration
├── packages/                   # Core modular library packages
│   ├── cache/                  # DirectionalLRUCache & BlobCache
│   ├── compiler/               # Video probe, extraction, LUT & packaging pipeline
│   ├── core/                   # Zoetrope orchestrator
│   ├── decoder/                # Decoders (WebWorker, ImageDecoder, ImageBitmap)
│   ├── manifest/               # Schema validation & variant negotiation
│   ├── motion/                 # Physics smoother & motion LUT mapping
│   ├── react/                  # React hooks and components
│   ├── renderer/               # High-performance 2D canvas blitter
│   └── streaming/              # PriorityQueue, ChunkStreamer & CEPK unpacker
├── scripts/                    # CLI utilities, clean scripts, and demo launchers
├── shared/                     # Single shared location for example assets (6.90 MB)
│   └── assets/showcase/        # Authoritative showcase sequence
└── tests/                      # Vitest unit/integration tests and Playwright E2E suites
```

---

## 2. One Artifacts Root (`.artifacts/`)

All generated outputs are strictly confined to the top-level `.artifacts/` folder:
- **Compiled Sequences**: Stored in `.artifacts/custom/<hash>/`.
- **E2E Test Artifacts**: Screenshots, videos, and trace archives only capture on failure and output to `.artifacts/test-results/`.
- **Reports**: Playwright HTML reports output to `.artifacts/playwright-report/`.
- **Benchmark Assets**: Generated strictly on-demand into `.artifacts/bench/`.

The working tree remains pristine during local development and CI runs.

---

## 3. Clean Commands

Cross-platform cleaning routines are available via `scripts/clean.ts`:

- `pnpm clean`: Removes `.artifacts/`, test result directories, and all `dist/` build folders across all packages and examples.
- `pnpm clean:deep`: Performs `pnpm clean` and additionally removes `node_modules/` and `.pnpm-store/`.

---

## 4. Caching & Disk Conservation Mechanics

### Content-Hashed Build Cache
- `computeBuildHash`: Produces a deterministic SHA-256 hash across the video input size/content, compiler version, and exact compilation parameters.
- Re-compiling identical inputs is instantaneous (`up to date, skipped compile`) with zero disk writes.
- `pnpm demo:video` automatically prunes older custom builds, keeping only the latest $N=2$ sequences.

### Disk Guard
Before extraction begins, the compiler CLI:
1. Samples probe parameters and estimates total output byte size ($F \times V \times \text{median bytes}$).
2. Checks available filesystem space via `fs.statfsSync`.
3. Warns and halts compilation if estimated size $> 500$ MB or free disk $< 2\times$ estimate unless confirmed with `--yes`.

### Asset Deduplication
Instead of duplicating ~7MB of showcase assets in each example repository:
- All showcase assets originate from `shared/assets/showcase/`.
- Examples read directly from the shared directory via Vite dev/preview middleware or load on-demand if missing.
- Prevents 20+ MB of duplicate file bloat in the git repository.

