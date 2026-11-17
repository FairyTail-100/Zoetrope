---
name: zoetrope-new-project
description: Scaffolding a clean, standalone Vite + Zoetrope client project. Use when starting a new video-driven web experience.
---

# New Project Scaffolding

Generate a clean, standalone client application wired to `@zoetrope/core` with a sticky scroll canvas layout, Vite bundler, and placeholder manifest.

## Scaffolding Command

From the root of this repository:
```bash
# Default mode: uses portable vendor tarballs (works anywhere, outside repo)
pnpm tsx scripts/new-project.ts <target-directory> [project-name]

# Published mode: uses npm version ranges (unverified until published)
pnpm tsx scripts/new-project.ts <target-directory> [project-name] --published
```

### Example
```bash
pnpm tsx scripts/new-project.ts ./apps/my-scroll-site "Luxury Watch Reveal"
```

## Generated Project Structure

```text
my-scroll-site/
├── package.json          # Dependencies using portable file:./vendor/*.tgz or npm version
├── pnpm-workspace.yaml   # Local workspace and esbuild approvals
├── .npmrc                # Isolated lockfile configuration
├── vite.config.ts        # Vite config with CORS dev headers
├── index.html            # 300vh scroll container + 100vh sticky canvas viewport
├── src/
│   └── main.ts           # Initializes Zoetrope with ?manifest= support
├── public/
│   └── assets/demo/      # Minimal runnable demo manifest + placeholder frames
└── README.md
```

## Running the New Project

```bash
cd apps/my-scroll-site
pnpm install
pnpm dev
```

Visit `http://localhost:5173` to test the scroll canvas.

## Replacing the Demo with Your Video

1. Transcode your video into the project assets folder:
   ```bash
   pnpm zoetrope compile my-video.mp4 --out apps/my-scroll-site/public/assets/hero --fps 24
   ```
2. Update `src/main.ts` or pass `?manifest=/assets/hero/manifest.json` in the browser URL.
