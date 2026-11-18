# Zoetrope Skills Index

Quick-lookup index of all 7 specialized agent skills.

| Skill | Trigger Prompt / Intent | Primary Script / Command | Target Output |
| :--- | :--- | :--- | :--- |
| **[`zoetrope-engine`](zoetrope-engine/SKILL.md)** | Start task, monorepo routing, check feature status | `pnpm zoetrope doctor` | Architecture overview |
| **[`zoetrope-compile-video`](zoetrope-compile-video/SKILL.md)** | Transcode `.mp4/.mov` into frames, configure variants | `pnpm zoetrope compile <video> --out <dir>` | `manifest.json` + frames |
| **[`zoetrope-integrate`](zoetrope-integrate/SKILL.md)** | Add player to React, Next.js, Astro, or HTML | `pnpm add @zoetropejs/core` | Responsive canvas player |
| **[`zoetrope-compose`](zoetrope-compose/SKILL.md)** | Multi-track layering, iris circular masks, cues | `new ZoetropeComposition({ layers, cues })` | Orchestrated composition |
| **[`zoetrope-deploy-cloudflare`](zoetrope-deploy-cloudflare/SKILL.md)** | Deploy assets to Cloudflare Pages/Workers | Static publish with `_headers` | Fast CDN edge caching |
| **[`zoetrope-troubleshoot`](zoetrope-troubleshoot/SKILL.md)** | Fix stalls, color shifts, memory/request storms | Inspect diagnostic table | Bug fix & verified test |
| **[`zoetrope-new-project`](zoetrope-new-project/SKILL.md)** | Scaffold clean standalone Vite + Zoetrope site | `pnpm tsx scripts/new-project.ts <dir>` | Standalone runnable app |

