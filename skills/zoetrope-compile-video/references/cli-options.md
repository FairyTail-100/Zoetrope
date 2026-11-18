# ZoetropeJS Compiler CLI Options Reference

The compiler binary is available via `pnpm zoetropejs` or `node packages/compiler/dist/cli.js`.

Usage:
```bash
pnpm zoetropejs compile <input-video> --out <output-dir> [options]
```

| Option | Type / Default | Description |
| :--- | :--- | :--- |
| `<input-video>` | String (required) | Path to input video file (`.mp4`, `.mov`, `.webm`). Also accepted via `--input <path>`. |
| `--out <dir>` | String (required) | Output directory for manifest and frames (alias: `--output`). |
| `--fps <number>` | Number (default: source FPS) | Target output frame rate. |
| `--start <seconds>` | String / Number (optional) | Video slice start offset (e.g. `--start "00:00:02"` or `--start 5.5`). |
| `--end <seconds>` | String / Number (optional) | Video slice end offset (e.g. `--end 15.0`). |
| `--format <fmt>` | String (default: `webp`) | Single output format: `webp`, `avif`, or `jpeg`. |
| `--formats <list>` | String (optional) | Comma-separated output formats (e.g. `avif,webp`). |
| `--variant <spec>` | String (repeatable) | Variant spec `"id:width:height:minWidth"` (can specify multiple). |
| `--motion-lut <mode>` | String (optional) | Motion curve mode: `auto`, `linear`, or `<path-to-json>`. |
| `--packing <mode>` | String (default: `individual`) | Frame storage: `individual`, `chunked` (experimental), or `range`. |
| `--force` | Boolean | Bypass cache and force re-compilation of existing frames. |
| `--yes` | Boolean | Bypass disk safety guard prompt when output exceeds 500MB. |

## Default Variants
When `--variant` is omitted, two responsive variants are generated:
- `desktop`: 1920x1080 (`minWidth: 768`, downscaled if source is smaller/adjusted via `--desktop-width`)
- `mobile`: 640x360 (`minWidth: 0`, adjusted via `--mobile-width`)

