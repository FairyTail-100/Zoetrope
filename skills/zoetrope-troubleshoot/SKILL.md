---
name: zoetrope-troubleshoot
description: Root-cause diagnosis and fixes for real bugs (compile stalls, color shifts, request storms, cache thrashing, path spaces). Use when diagnosing failures or performance regressions.
---

# Troubleshooting & Root-Cause Diagnoses

Quick-reference diagnostic table for real-world issues encountered across compilation, networking, cache, and playback.

## Symptom-to-Cause-to-Fix Matrix

| Symptom | Cause | Fix | Guarding Test |
| :--- | :--- | :--- | :--- |
| **Compile stalls at 0/0** | Missing probe frame count or blocked stdin. | Compute `Math.floor(duration * fps)`; pass `-nostdin` and stdio `ignore`. | `tests/compiler-progress.test.ts` |
| **Yellows/greens color shift** | Wrong matrix: BT.601 (`bt470bg`) used on BT.709 video. | Inspect probe color tags; use `in_color_matrix=bt709` for HD/BT.709. | `tests/compiler-color.test.ts` |
| **Request storm at idle** | Prefetch refills frames evicted from decoded cache. | Check `BlobCache` residency before fetch; clamp prefetch window to budget. | `tests/cache.test.ts` |
| **Desktop loads Mobile variant** | Breakpoint match order inverted in `selectVariant`. | Sort variants descending and pick smallest variant $\ge$ viewport dimension. | `tests/manifest.test.ts` |
| **`?manifest=` param ignored** | Client hardcodes static path. | Decode `new URLSearchParams(location.search).get('manifest')`. | `tests/e2e/examples-and-lifecycle.spec.ts` |
| **Scrubbing spikes error rate** | Routine `AbortController.abort()` counts as fetch errors. | Filter `name === 'AbortError'` from error counters. | `tests/streaming.test.ts` |
| **Compile consumes huge disk** | Compiling full video at high fps with all variants. | Use `--start`/`--end`/`--fps 24`; confirm with `--yes` disk guard. | *(CLI guard in `packages/compiler/src/cli.ts`)* |
| **Crash on paths with spaces** | Windows paths containing spaces split when passed to shell. | Pass arguments as `string[]` to `spawn` with `shell: false`. | `tests/compiler-edge-cases.test.ts` |
| **CORS / Canvas taint errors** | Manifest or images served without CORS header. | Add `Access-Control-Allow-Origin: *` to CDN headers or Vite middleware. | `tests/e2e/examples-and-lifecycle.spec.ts` |

## Inspection Files & Detailed Catalog

For code pointers, offending files, and reproduction steps:
👉 [references/bug-catalog.md](references/bug-catalog.md)

