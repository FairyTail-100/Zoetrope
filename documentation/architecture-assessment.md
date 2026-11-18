# Technical Assessment & Architectural Specification
## ZoetropeJS: Engineering a Framework-Agnostic Animation Pipeline

---

## 1. Critical Audit Deconstruction & Technical Assessment

High-performance interactive web productions demonstrate advanced scroll-driven sequence playback. Evaluating these techniques reveals what is foundational versus what is site-specific or premature for a general-purpose engine.

### 1.1 Techniques Evaluated for Adoption

| Technique | Context | Assessment | Status in Current Engine |
| :--- | :--- | :--- | :--- |
| **Directional LRU Caching with Asymmetric Penalties** | Asymmetric lookbehind eviction | Mobile browsers (e.g. iOS WebKit) enforce strict memory limits (Jetsam thresholds ~224MB–448MB). When scrolling forward, frames behind the playhead are significantly less likely to be revisited than upcoming frames. Applying an eviction penalty to backwards frames retains upcoming frames longer while strictly capping memory footprint. | **Adopted** in `@zoetropejs/cache`. Enforces memory budgets using uncompressed decoded RGBA byte calculation ($W \times H \times 4$), prevents eviction of the active displayed frame, and accounts for in-flight decodes. |
| **Asset Packaging: Individual vs. Binary Bundling** | WebP vs packed chunks | Individual file fetching avoids custom container complexity and leverages standard HTTP caching, but can increase connection queue overhead on slow networks. Binary chunking bundles frames into single requests. | **Individual frames is standard and production default.** Binary packaging (`CEPK` container) and HTTP Range are marked as experimental, off by default, no further investment until real-network evidence. |
| **Off-Main-Thread Bitmap Decoding** | Browser image decoding | Main-thread image parsing can cause layout recalculation and frame drops. `createImageBitmap(blob)` enables asynchronous decode off the main thread. | **Adopted** in `@zoetropejs/decoder` (`NativeBitmapDecoder`). |
| **Worker Pool Decoding** | Multi-threaded decode workers | Spawns multiple Web Workers to run decodes in parallel. | **Not yet implemented.** Main-thread async `createImageBitmap` is used for Phase 1. WorkerPoolDecoder is planned for Phase 3 performance engineering. |
| **Time-Constant Exponential Decay Smoothing** | Frame-rate independent easing | Linear interpolation (`lerp(cur, target, factor)`) is frame-rate dependent. Exponential decay: $y(t) = y_{target} + (y_0 - y_{target})e^{-\Delta t / \tau}$ decouples physics from display refresh rate (60Hz, 120Hz, 240Hz). | **Adopted** in `@zoetropejs/motion` (`ExponentialSmoother`). Can be completely disabled for deterministic frame scrubbing. |
| **MotionLUT (Motion Normalization)** | Camera velocity mapping | Normalizes perceived animation speed across non-linear camera speeds using a 1D monotonic curve mapping $s \in [0, 1] \rightarrow [0, N-1]$. | **Adopted** in `@zoetropejs/motion` (`MotionLUT`). Note: generating LUTs via optical flow analysis is a deferred compiler task, not currently claimed. |
| **Sharp Image Processor** | Mentioned in planning | Native Node image processing pipeline. | **Not yet implemented.** FFmpeg currently handles frame extraction and WebP encoding directly. |

---

## 2. Validation of Uncertainties & Claims

1. **The AMBP Byte Discrepancy:**
   - On disk: ASCII `"AMBP"` bytes are `[0x41, 0x4D, 0x42, 0x50]`.
   - Read as 32-bit Little-Endian integer: `0x50424D41`.
   - Read as 32-bit Big-Endian integer: `0x414D4250`.
   - The discrepancy in the audit was caused by mixing endianness representations.
   - *Engine Specification:* We defined **`CEPK` (ZoetropeJS packet v1)** with explicit Little-Endian encoding, header CRC32, and per-frame payload CRC32 checksums.

2. **Latency & Performance Claims:**
   - Frame retrieval and decode performance depends on device hardware, display resolution, GPU capabilities, and network conditions.
   - All performance figures in documentation are backed by reproducible benchmark runs under defined environments (CDP throttling, device, resolution).

3. **Memory Budgeting:**
   - Uncompressed RGBA buffer: $\text{width} \times \text{height} \times 4\text{ bytes}$.
   - A $1920 \times 1080$ frame occupies $\approx 8.29\text{ MB}$ uncompressed.
   - Memory budgets are feature-detected using `navigator.deviceMemory`, falling back on Safari/Firefox to a conservative calculation based on viewport dimensions and `(pointer: coarse)`.

---

## 3. Monorepo Architecture

```
custom-video-pipeline/
├── packages/
│   ├── manifest/             # Schemas, types, validators, resolution selector
│   ├── cache/                # Directional LRU cache with byte budgeting & close() cleanup
│   ├── motion/               # Exponential decay filter, velocity tracker, MotionLUT, scroll driver
│   ├── decoder/              # NativeBitmapDecoder & FallbackImageDecoder (WorkerPoolDecoder: Planned)
│   ├── streaming/            # Priority queue, lookahead prefetch scheduler, CEPK unpacker
│   ├── renderer/             # Canvas 2D engine, DPR compensation, cover/contain math
│   ├── compiler/             # Node CLI & library: FFmpeg frame extractor, pack builder (Sharp: Planned)
│   ├── core/                 # ZoetropeJS orchestrator & event bus
│   └── react/                # React hook (useZoetrope) and <ZoetropeCanvas />
├── examples/
│   └── basic-scroll/         # Interactive showcase with telemetry HUD
├── documentation/
│   ├── asset-format.md       # CEPK v1 binary layout, endianness, and hex dump
│   └── architecture-assessment.md
├── benchmarks/               # Automated CDP Playwright benchmark suite & HTTP/1/2 server
└── tests/                    # Unit and Playwright E2E verification tests
```

---

## 4. Phase 1 Acceptance Criteria (Verbatim from Specification)

To be accepted as Phase 1 complete, the implementation must:
- Accept an image sequence.
- Generate a manifest.
- Load the sequence.
- Render it on Canvas.
- Map scroll position to the correct frame.
- Preload nearby frames.
- Support forward and reverse scrolling.
- Maintain a bounded frame cache.
- Resize correctly.
- Handle loading and decoding failures.

The result must be a working demonstration, not just interfaces and placeholder code.

---

## 5. Main Technical Risks & Mitigations

1. **Browser Memory Exhaustion (WebKit Jetsam on iOS):**
   - Explicit byte-based budget calculation ($W \times H \times 4$).
   - Active displayed frame is protected from eviction.
   - Evicted bitmaps have `.close()` called immediately.
2. **Network Queue Congestion on Rapid Direction Reversals:**
   - `AbortController` triggers on out-of-horizon requests.
   - Rejections with `AbortError` handled cleanly without unhandled promise rejections.
3. **Late Decode Overwrites:**
   - If decode finishes after cursor has moved, frame is cached or discarded by policy, and NEVER painted over the current active frame.

---

## 6. Empirical Verification & Packaging Comparison Matrix

Captured across 120 scenarios and 600 independent browser runs in Chromium with Chrome DevTools Protocol network/CPU emulation:

| Packaging Variant | Protocol | 1st Frame (Unth.) | 1st Frame (Fast 4G) | 1st Frame (Fast 3G 4x) | p95 Render (1x) | p95 Render (4x) | p95 Decode (p95) | Long Tasks (>50ms) | Hit Rate (Slow / Fwd) | Manifest Size |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`individual`** | HTTP/1.1 | 7ms [6-10] | 62ms [62-64] | 87ms [84-88] | 0.05ms | 0.21ms | 14.51ms | **0** | 66% / 52% | 588 bytes |
| **`chunked-hero-8`** | HTTP/1.1 | 5ms [5-5] | 63ms [53-65] | 113ms [97-114] | 0.04ms | 0.20ms | 11.25ms | **0** | 79% / 51% | 8,132 bytes |
| **`chunked-25`** | HTTP/1.1 | 6ms [6-7] | 62ms [61-64] | 96ms [75-100] | 0.05ms | 0.22ms | 13.13ms | **0** | 77% / 52% | 2,888 bytes |
| **`range`** | HTTP/1.1 | 5ms [4-5] | 79ms [78-79] | 221ms [215-225] | 0.04ms | 0.21ms | 8.93ms | **0** | 61% / 52% | 32,042 bytes |
| **`individual`** | HTTP/2 | 7ms [4-7] | 63ms [62-64] | 80ms [66-85] | 0.10ms | 0.20ms | 10.30ms | **0** | 67% / 52% | 588 bytes |
| **`chunked-hero-8`** | HTTP/2 | 5ms [4-5] | 63ms [62-63] | 111ms [109-112] | 0.10ms | 0.30ms | 10.90ms | **0** | 77% / 51% | 8,132 bytes |
| **`chunked-25`** | HTTP/2 | 5ms [5-5] | 63ms [63-63] | 69ms [67-97] | 0.10ms | 0.30ms | 10.80ms | **0** | 78% / 52% | 2,888 bytes |
| **`range`** | HTTP/2 | 5ms [4-7] | 77ms [76-79] | 225ms [221-226] | 0.10ms | 0.30ms | 8.50ms | **0** | 65% / 52% | 32,042 bytes |
