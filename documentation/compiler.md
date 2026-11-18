# ZoetropeJS Asset Compiler & Validator (`@zoetropejs/compiler`)
## Production-Grade Video Extraction, Format Encoding, and Manifest Compiler

---

## 1. Overview & Architecture

`@zoetropejs/compiler` provides an industrial-grade asset compilation pipeline that converts arbitrary input videos into high-performance, deterministic scroll-driven sequence packages. It features:

- **Single-Pass Multi-Variant Extraction:** Emits desktop, mobile, and tablet resolution variants simultaneously via FFmpeg `-filter_complex` split graphs, decoding video frames exactly once.
- **Multi-Format Support:** First-class compilation to WebP (default), AVIF (via Sharp), and JPEG.
- **Color Space & Aspect Ratio Preservation:** Preserves BT.709 color matrices and accurate chroma interpolation (`accurate_rnd+full_chroma_int`), supporting both `cover` (fill + crop) and `contain` (letterbox padding) aspect ratios.
- **Resumable Content-Addressed Caching:** Hashes source media content and compilation options to make re-runs instantaneous (<1s no-op).
- **Atomic Writes & Safe Interrupts:** Writes into isolated temporary workspaces (`.tmp-<uuid>`) and atomically commits to the output directory only upon full verification. Cleanly cleans up child processes and temp files on `AbortSignal` or `SIGINT`.
- **Deep Offline Validator:** Includes `zoetropejs ` with fast schema checks and deep binary image header validation.
- **Heuristic Motion-LUT Normalization:** Automatically analyzes frame-to-frame luminance differences to stretch scroll distance during rapid motion and compress static segments.

---

## 2. CLI Reference (`zoetrope`)

The CLI is available directly as `zoetrope` (or `pnpm zoetropejs`). Requires **Node >= 20** and **FFmpeg >= 6.0** (with `scale=in_color_matrix=bt601` support; verified by `zoetropejs `).

```bash
zoetropejs  <input-video> --out <output-dir> [options]
zoetropejs  <manifest-path> [--deep] [--json]
```

### 2.1 `compile` Command Options

| Flag | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<input>` | `string` | *(required)* | Path to source video file (supports MP4, MOV, WebM, VFR, 10-bit, rotated). |
| `--out`, `--output` | `string` | *(required)* | Target directory for generated frames, packs, and `manifest.json`. |
| `--id` | `string` | Basename of input | Unique animation sequence ID in manifest. |
| `--variant` | `string` | *(see below)* | Variant definition formatted as `id:width:height:minWidth`. Can be specified multiple times. |
| `--format` | `string` | `webp` | Target image format: `webp`, `avif`, or `jpeg`. |
| `--quality` | `number` | Format default | Compression quality: 80 for WebP, 65 for AVIF, 85 for JPEG. |
| `--fps` | `number` | Input video FPS | Target frame rate. Variable frame rate (VFR) inputs are normalized to CFR. |
| `--step` | `number` | `1` | Frame decimation step (e.g. 2 for half-rate). |
| `--start` | `string` | Start of file | Start timestamp or offset in seconds (e.g. `00:00:02` or `2.5`). |
| `--end` | `string` | End of file | End timestamp or offset in seconds. |
| `--packing` | `string` | `individual` | Packaging topology: `individual` (standard), `chunked` (CEPK), or `range`. |
| `--chunk-size` | `number` | `24` | Frames per chunk when `--packing chunked`. |
| `--fit` | `string` | `cover` | Aspect ratio preservation mode: `cover` (crop) or `contain` (letterbox). |
| `--checksum` | `boolean` | `false` | Computes and embeds SHA-256 checksums per frame or chunk in manifest. |
| `--anchors` | `number` | *(none)* | Generates 1/4 resolution anchor frames every N frames (e.g. `--anchors 10`). |
| `--motion-lut` | `string` | `linear` | Motion LUT curve: `auto` (heuristic motion-stretch), `linear`, or path to JSON. |
| `--force` | `boolean` | `false` | Ignores `.build-cache.json` and forces complete recompilation. |

#### Default Multi-Variant Setup
If `--variant` is omitted, the compiler defaults to a responsive dual-variant layout:
1. `desktop`: `1920x1080`, `minWidth: 768`
2. `mobile`: `640x360`, `minWidth: 0`

### 2.2 `validate` Command Options

| Flag | Type | Description |
| :--- | :--- | :--- |
| `<manifest-path>`| `string` | Path to `manifest.json` on disk. |
| `--deep` | `boolean` | Parses binary image headers of all frames to verify dimensions and detect corrupted bytes. |
| `--json` | `boolean` | Emits validation output as a machine-readable JSON structure and exits with status 1 on error. |

---

## 3. Library API Reference

Import `compile` or `validateManifestFile` directly into Node.js applications:

```typescript
import { compile, validateManifestFile } from '@zoetropejs/compiler';

// Compile sequence
const manifest = await compile({
  input: './footage/clip.mp4',
  outputDir: './public/assets/clip',
  fps: 30,
  format: 'webp',
  quality: 80,
  variants: [
    { id: 'desktop', width: 1920, height: 1080, minWidth: 768, fit: 'cover' },
    { id: 'mobile', width: 640, height: 360, minWidth: 0, fit: 'cover' },
  ],
  anchors: 10,
  motionLut: 'auto',
  checksum: true,
  onProgress: (event) => {
    console.log(`[${event.percent}%] ${event.stage}: ${event.message}`);
  },
});

// Validate generated manifest
const result = await validateManifestFile('./public/assets/clip/manifest.json', { deep: true });
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}
```

### Cancellation with `AbortSignal`
Pass an `AbortSignal` to cancel in-flight FFmpeg processes immediately:
```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);

try {
  await compile({ input: 'clip.mp4', outputDir: './out', signal: controller.signal });
} catch (err) {
  console.log('Compilation safely cancelled; temporary files cleaned up.');
}
```

---

## 4. Multi-Format Benchmark Evaluation & Findings

We benchmarked a 1080p sequence with realistic film grain and detail across **WebP**, **AVIF**, and **JPEG** under identical source conditions. All decodes were measured inside Chromium via Playwright using native `createImageBitmap(blob)` under both unthrottled and 4x CPU throttle:

> Note: These numbers come from `benchmarks/run-format-comparison.ts` on a single machine and are not checked in.

| Format | Median Byte Size / Frame | Total 30-Frame Size | Encode Time / Frame | Decode 1x (p50 / p95) | Decode 4x CPU (p50 / p95) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`WEBP`** | **127.2 KB** | 3.74 MB | 96.1 ms | 10.2 ms / 12.4 ms | **11.8 ms / 16.1 ms** |
| **`AVIF`** | **16.4 KB** | **0.48 MB** *(87% smaller)*| 175.4 ms | 8.0 ms / 17.8 ms | **9.5 ms / 15.3 ms** |
| **`JPEG`** | 134.8 KB | 3.99 MB | 8.2 ms | 4.5 ms / 6.2 ms | **5.0 ms / 8.9 ms** |

> **Architectural Findings & Format Recommendation:**
> 1. **WebP (Production Default):** Provides balanced decoding performance, rapid encode times, universal browser support, and seamless streaming with native `createImageBitmap`.
> 2. **AVIF (Recommended for Bandwidth-Constrained Deployments):** Achieves an extraordinary **87% byte size reduction** (16.4 KB vs 127.2 KB per frame) while maintaining decode latency under 16ms on 4x throttled CPUs. Because FFmpeg's `image2` muxer does not natively support sequential ISOBMFF AVIF container output, the compiler integrates Sharp to encode AVIF frames rapidly.
> 3. **JPEG:** Fastest encoding (8.2ms) and lowest decode latency, but largest byte size. Useful for local development and rapid preview builds.

---

## 5. Heuristic Motion-LUT Normalization

The compiler includes an automatic motion-stretch algorithm (`--motion-lut auto`) that normalizes scroll travel to visual motion dynamics.

### How It Works
1. Consecutive frames are extracted as 64x36 grayscale luminance buffers ($2304\text{ bytes/frame}$).
2. Mean Absolute Difference (MAD) is computed between adjacent frames:
   $$\text{MAD}_k = \frac{1}{2304} \sum_{p=0}^{2303} |Y_k(p) - Y_{k+1}(p)|$$
3. A baseline travel weight $\epsilon = 1.0$ is added to prevent static holds from freezing scroll.
4. The cumulative sum $C_k = \sum w_i$ is computed, normalized to $[0, 1]$, and monotonically resampled to the target LUT size.

### Empirical Effect Demonstration
On a sequence containing 1 second of static freeze frame followed by 1 second of rapid motion:

| Progress Interval ($s$) | Visual Motion Category | Measured Local Slope ($\frac{\Delta y}{\Delta s}$) | Perceived User Scroll Speed |
| :--- | :--- | :--- | :--- |
| **$s \in [0.20, 0.40]$** | Static Freeze Hold | **$0.0017$ (Flat slope)** | Quick scroll pass-through; user quickly advances past static frame |
| **$s \in [0.70, 0.90]$** | High Dynamic Motion | **$0.1630$ ($96\times$ steeper)** | Expanded scroll travel; camera movement moves gracefully across scroll gesture |

---

## 6. Build Caching & Atomic Commits

### Resumable Caching
1. The compiler computes a SHA-256 build hash over:
   - Input file identity: size, mtime, and sample byte hashes of the first and last 1 MB.
   - Compilation options: variants, formats, qualities, fps, step, fit, checksums, and anchors.
   - Compiler version (`1.0.0`).
2. When the build matches `.build-cache.json` and all output files exist, compilation returns the manifest in **<50ms**.
3. Use `--force` to bypass cache.

### Atomic Commits
- All frame extraction, chunking, and manifest generation occur in an isolated directory: `<outputDir>/.tmp-<uuid>`.
- Only when all frames are verified and the manifest passes validation are files atomically moved into `<outputDir>`.
- On SIGINT, SIGTERM, or `AbortSignal`, the temporary directory is deleted immediately, guaranteeing zero corrupted half-written files.
