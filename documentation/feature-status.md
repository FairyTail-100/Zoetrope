# Zoetrope Feature Status Matrix

This matrix provides the authoritative status of all features and subsystems. A feature is marked **`stable`** only when automated real-browser or headless integration tests guard it.

- **`stable`**: Verified in real browser Playwright automation (zero errors, non-blank canvas, real scroll events, and state assertion).
- **`experimental`**: Implemented behind explicit opt-in flags; documented with known constraints.
- **`unverified-on-mobile`**: Verified under Chromium mobile device emulation (Pixel 7), but unverified on physical bare-metal iOS Safari hardware.
- **`unverified`**: Functional in local tests but unverified on target platform or legacy browsers.

---

## Packaging & CDN Delivery Recommendation

- **Individual WebP (`packing: 'individual'`)**: **`stable` (Production Default)**. This is the **strongly recommended path** for Cloudflare Pages/Workers, Vercel, Netlify, and S3/CloudFront. Combined with long immutable cache headers (`Cache-Control: public, max-age=31536000, immutable`) and content-hashed version tags (`?v=<buildhash>`), it achieves optimal CDN edge caching with zero binary unpack overhead.
- **CEPK / Range Packing (`packing: 'chunked'` / `'range'`)**: **`experimental`**. Binary packet format and HTTP/2 byte-range streaming. Useful in request-capped architectures, but requires strict HTTP Range header support and bypasses standard single-image edge caching.

---

## Detailed Subsystem Status

| Feature / Subsystem | Status | Activation / Flag | Verification Evidence & Test Guard |
| :--- | :--- | :--- | :--- |
| **Deterministic Frame Lookup** | `stable` | Default (`playback.mode: 'scroll'`) | `tests/e2e/browser-verification.spec.ts`: verified `round(p*(N-1))` across forward/reverse scrub. |
| **Two-Tier Blob Cache (`BlobCache`)** | `stable` | Default (`cache.blobBudgetMb: 128`) | `tests/cache.test.ts` & `tests/e2e/examples-and-lifecycle.spec.ts`: 0 repeated requests, 0 reqs reverse. |
| **Directional LRU Cache** | `stable` | Default | `tests/cache.test.ts`: active displayed frame protected; byte budgeting enforced. |
| **Variant Selection (Desktop vs Mobile)** | `stable` | Default (`selectVariant`) | `tests/manifest.test.ts` & `tests/e2e/examples-and-lifecycle.spec.ts`: 1920x1080 $\to$ DESKTOP, 390x844 $\to$ MOBILE. |
| **Low-Res Anchor Sets** | `stable` | Default (`anchors: 10`) | `tests/e2e/browser-verification.spec.ts`: stall fallback prevents blank canvas during 404s/throttling. |
| **Velocity Prefetch & Fling Prediction** | `stable` | Default (`flingPrediction: true`) | `tests/streaming.test.ts` & `tests/e2e/browser-verification.spec.ts`: lookahead scales with scrub velocity. |
| **Abort-on-Reversal** | `stable` | Default | `tests/e2e/browser-verification.spec.ts`: Out-of-horizon fetches aborted without unhandled rejections. |
| **Fault Fallback (404 & Corrupt Bytes)** | `stable` | Default | `tests/e2e/browser-verification.spec.ts`: route interception retains fallback, canvas never blank. |
| **BT.709 Color Pipeline (Full-Range sRGB)** | `stable` | Default | `tests/compiler-color.test.ts`: limited/full range, 5-level neutral ramp, skin tones within $\le 6$ RGB units. |
| **NativeBitmapDecoder & <img> Fallback** | `stable` | Default (`createImageBitmap`) | `tests/failure-paths.test.ts` & `tests/engine.test.ts`: background decode off main thread, fallback on error. |
| **Format Negotiation (AVIF $\to$ WebP)** | `stable` | Multi-format manifest sources | `tests/e2e/browser-verification.spec.ts`: simulated AVIF decode failure falls back to WebP seamlessly. |
| **Layered Composition & DOM Cues** | `stable` | `new ZoetropeComposition(...)` | `tests/composition.test.ts` & `tests/e2e/examples-and-lifecycle.spec.ts`: multi-track compositing, iris mask expansion. |
| **React & Next.js Production Adapter** | `stable` | `@zoetropejs/react` | `tests/e2e/examples-and-lifecycle.spec.ts`: Next.js production build (`next start`) with zero hydration warnings. |
| **Astro Island Client Hydration** | `stable` | `examples/astro` | `tests/e2e/examples-and-lifecycle.spec.ts`: Astro preview server hydrates with zero console errors. |
| **Tab Visibility Pause & Resume** | `stable` | Default (`visibilitychange`) | `tests/e2e/examples-and-lifecycle.spec.ts`: pause state and frame persistence verified on restore. |
| **prefers-reduced-motion Poster Frame** | `stable` | Default (`respectReducedMotion: true`) | `tests/e2e/examples-and-lifecycle.spec.ts`: renders static poster frame 0 without continuous scrub. |
| **Resize Storm Debouncing** | `stable` | Default (`debounceResizeMs: 250`) | `tests/e2e/examples-and-lifecycle.spec.ts`: 20 rapid viewport resizes in 1s handled with zero errors. |
| **BFCache Restore (pageshow)** | `stable` | Default (`pageshow`) | `tests/e2e/examples-and-lifecycle.spec.ts`: `persisted: true` re-renders canvas without errors. |
| **Canvas Context Loss Recovery** | `stable` | Default (`contextlost`/`contextrestored`) | `tests/e2e/examples-and-lifecycle.spec.ts`: `RendererError` surfaced and redrawn upon restore. |
| **Mobile Emulation Profile** | `stable` (emulated) | Pixel 7 Playwright device | `tests/e2e/browser-verification.spec.ts`: mobile variant selection verified in Chromium emulation. |
| **WorkerPoolDecoder** | `experimental` | `decoder.preferWorker: true` | Dedicated Web Workers transfer ImageBitmaps off the main thread. |
| **CEPK / Range Binary Packing** | `experimental` | Compiler `--packing range\|chunked` | Multi-frame chunk slicing; requires HTTP/2 byte-range server header support. |
| **Adaptive DPR Downgrade** | `experimental` | `adaptive: { enabled: true }` | Early sliding-window latency downgrade; bidirectional recovery hysteresis in development. |
| **WebCodecs ImageDecoder** | `experimental` | `decoder.useWebCodecs: true` | Feature-detected W3C `ImageDecoder` behind standard interface; off by default; no GOP video path. |
| **Hit-Rate Metric Definition** | `experimental` | Telemetry API (`engine.stats().hitRatePct`) | Defined as resident-at-draw-time vs scheduled requests; can register temporary dips during instantaneous reversals. |
| **Mobile WebKit Jetsam Memory Limits** | `unverified-on-mobile` | `cache.detectDeviceMemoryBudget()` | Verified under simulated desktop/emulation memory limits; unverified on bare-metal physical iOS Safari. |
| **Touch Inertial Deceleration** | `unverified-on-mobile` | `ScrollDriver` | Verified on wheel and programmatic scroll; real iOS rubber-band inertial touch physics unverified. |
| **Native AVIF on Legacy Safari** | `unverified` | Compiler `--format avif` | Verified in modern Chromium; unverified on Safari versions prior to 16.4. |
