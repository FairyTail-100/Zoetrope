# ZoetropeJS Agent Skills

This directory contains 7 specialized skills designed for AI agents and developers working with ZoetropeJS.

## Skill Directory Structure

Every skill follows the standard Agent Skills specification:
- `SKILL.md`: Main instruction file with YAML frontmatter (`name`, `description`) and concise step-by-step guidance (<150 lines).
- `references/`: Detailed reference documentation, API types, options, and tables.
- `scripts/`: Production-grade TypeScript utility scripts runnable via `tsx`.

## Available Skills

| Skill | Directory | Purpose |
| :--- | :--- | :--- |
| **Engine Router** | `zoetrope-engine` | Root architectural index, package structure, and sub-skill dispatch router. |
| **Compile Video** | `zoetrope-compile-video` | Compiling source videos into frame sequences, variants, and manifests with disk guard. |
| **Integrate** | `zoetrope-integrate` | Embedding the player in Vanilla JS, React, Next.js (SSR-safe), and Astro. |
| **Compose** | `zoetrope-compose` | Multi-track layering, iris masks, scroll windows, and DOM cue orchestration. |
| **Deploy Cloudflare**| `zoetrope-deploy-cloudflare` | Production static hosting on Cloudflare Pages/Workers with immutable frame caching. |
| **Troubleshoot** | `zoetrope-troubleshoot` | Root-cause diagnosis and fixes for real-world playback, compile, and network issues. |
| **New Project** | `zoetrope-new-project` | Scaffolding a clean, standalone Vite + ZoetropeJS client project. |

## Installation & Distribution

To export or install these skills into an external project repository:
```bash
# Default target: .agents/skills
pnpm skills:install

# Custom target:
pnpm skills:install /path/to/project/.agents/skills
```

