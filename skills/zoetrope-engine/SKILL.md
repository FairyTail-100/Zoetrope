---
name: zoetrope-engine
description: Root router and architectural index for ZoetropeJS. Use when starting work on the engine, navigating monorepo packages, or checking feature status.
---

# ZoetropeJS Router & Workflow

ZoetropeJS delivers bidirectional scroll-driven video playback on HTML5 Canvas using pre-decoded image sequences, directional LRU memory caching, and motion smoothing.

## Standard 5-Step Execution Workflow

1. **Check Prerequisites**: Run `pnpm zoetropejs doctor` (verifies Node >=20, pnpm, FFmpeg >=6.0, ffprobe, disk space).
2. **Compile Clip**: Run preflight estimation before compilation:
   ```bash
   pnpm tsx skills/zoetrope-compile-video/scripts/preflight.ts clip.mp4 public/assets/hero
   pnpm zoetropejs compile clip.mp4 --out public/assets/hero --fps 24
   ```
3. **Choose Integration**:
   - *New Site*: `pnpm tsx scripts/new-project.ts ./apps/my-app "Hero App"`
   - *Existing Site*: See `documentation/integration-guide.md`
   - *Multi-Layer Sequence*: See `skills/zoetrope-compose/SKILL.md`
   - *No-Build Script Tag*: See `dist-release/no-build.html`
4. **Verify Playback**: Run `pnpm test:scaffold` and `pnpm test:e2e`.
5. **Deploy**: Follow `skills/zoetrope-deploy-cloudflare/SKILL.md` for CDN caching.

## Package Architecture Map

| Package | Purpose | Real Export / Entrypoint |
| :--- | :--- | :--- |
| `packages/core` | Main orchestrator & composition | `ZoetropeJS`, `ZoetropeComposition` (multi-layer tracks, iris masks, cues) |
| `packages/renderer` | Canvas rendering | `CanvasRenderer` (DPR, cover/contain/fill) |
| `packages/cache` | 2-Tier memory caching | `DirectionalLRUCache`, `BlobCache`, budget detection |
| `packages/motion` | Scroll driving & physics | `ScrollDriver`, `ExponentialSmoother`, velocity tracking |
| `packages/streaming`| Range fetching & network | `ChunkStreamer`, `PriorityQueue`, residency check |
| `packages/decoder` | In-worker & DOM decoding | `NativeBitmapDecoder`, `WorkerPoolDecoder` |
| `packages/manifest` | Manifest types & validation| `validateManifest`, `selectVariant` |
| `packages/compiler` | Asset pipeline & CLI | `compile()`, `probeMedia()`, CLI `zoetrope` |
| `packages/react` | React component wrapper | `NextZoetropePlayer`, `useZoetrope` |

## Sub-Skill Dispatch Router

For detailed instructions, dispatch to the corresponding skill:
- **Transcoding videos**: 👉 `skills/zoetrope-compile-video/SKILL.md`
- **Framework wiring**: 👉 `skills/zoetrope-integrate/SKILL.md`
- **Multi-layer tracks & cues**: 👉 `skills/zoetrope-compose/SKILL.md`
- **Cloudflare edge deployment**: 👉 `skills/zoetrope-deploy-cloudflare/SKILL.md`
- **Troubleshooting & diagnostics**: 👉 `skills/zoetrope-troubleshoot/SKILL.md`
- **Scaffolding new project**: 👉 `skills/zoetrope-new-project/SKILL.md`
- **Full skills index**: 👉 `skills/INDEX.md`
