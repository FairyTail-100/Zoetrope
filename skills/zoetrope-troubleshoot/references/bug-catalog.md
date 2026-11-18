# ZoetropeJS Troubleshooting & Diagnostic Catalog

Detailed incident catalog with file locations, root causes, and regression tests.

| Symptom | Root Cause | File to Inspect | Guarding Test |
| :--- | :--- | :--- | :--- |
| **Compiler stalls at 0/0 (15%)** | Probe returned duration/fps but no frame count; stdin blocked or progress parser waiting for frame line | `packages/compiler/src/compiler.ts` | `tests/compiler-progress.test.ts` |
| **BT.709 color shift (yellows/greens shift)** | Compiler forced `in_color_matrix=bt470bg` on BT.709 footage, applying BT.601 matrix | `packages/compiler/src/compiler.ts` | `tests/compiler-color.test.ts` |
| **Request storm (thousands of 304s at idle)** | Decoded cache evicted frames, but no memory of blob remained, causing prefetch loop to refetch lookbehind continuously | `packages/cache/src/blob-cache.ts`<br>`packages/streaming/src/streamer.ts` | `tests/cache.test.ts`<br>`tests/streaming.test.ts` |
| **1920x1080 screen selects MOBILE variant** | Validator checked `viewportWidth <= v.width`, picking 854x480 first before checking larger | `packages/manifest/src/validator.ts` | `tests/manifest.test.ts` |
| **`?manifest=` param ignored in demo** | Client script hardcoded manifest path without checking `URLSearchParams` | `examples/basic-scroll/src/main.ts` | `tests/e2e/examples-and-lifecycle.spec.ts` |
| **HUD shows high error rate from aborts** | Cancelled fetches during rapid scrub incremented telemetry error counter | `packages/streaming/src/streamer.ts` | `tests/streaming.test.ts` |
| **Disk fills up during compilation** | High fps * multiple variants produced gigabytes unexpectedly without warning | `packages/compiler/src/cli.ts` | *(none)* |
| **Spawn crash on Windows path with spaces** | Command string was split by shell or output pattern `%04d` corrupted | `packages/compiler/src/compiler.ts` | `tests/compiler-edge-cases.test.ts` |
| **CORS / MIME type errors on Canvas** | Dev server or CDN serving WebP as text/html or missing `Access-Control-Allow-Origin` | `examples/basic-scroll/vite.config.ts` | `tests/e2e/examples-and-lifecycle.spec.ts` |

