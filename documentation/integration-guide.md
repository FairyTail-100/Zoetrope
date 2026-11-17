# Zoetrope Integration Guide

This guide covers production integration patterns for adding Zoetrope to existing websites across Vanilla JS, React, Next.js, and Astro.

---

## 1. Quick Installation

Install `@zoetrope/core` in your project:

```bash
# Standalone self-contained core runtime (proven outside repo):
pnpm add file:./dist-release/zoetrope-core-0.1.0-rc.1.tgz

# Or once published on npm:
pnpm add @zoetrope/core
```

> **Note on Tarballs**: The private monorepo root (`zoetrope-monorepo`) is `private: true` and is not packed. The single standalone runtime tarball is `zoetrope-core-0.1.0-rc.1.tgz` (which bundles all internal dependencies).

For React applications, also install `@zoetrope/react`:
```bash
pnpm add file:./dist-release/zoetrope-react-0.1.0-rc.1.tgz
```

---

## 2. Canvas & CSS Layout Requirements

The engine renders directly to an HTML5 `<canvas>`. To ensure smooth playback without layout shifts:

1. **Sticky Container Pattern**:
   A tall outer container (e.g. `height: 300vh`) defines the scroll duration. An inner element (`position: sticky; top: 0; width: 100vw; height: 100vh`) pins the canvas to the viewport.
2. **Explicit Sizing**:
   Give the canvas CSS dimensions `width: 100%; height: 100%; display: block;`. The engine manages internal `canvas.width` and `canvas.height` accounting for `window.devicePixelRatio`.
3. **GPU Compositing**:
   Add `contain: strict; will-change: transform;` on the pinned viewport container.

```html
<div class="scrolly-section" style="height: 350vh; position: relative;">
  <div class="sticky-pin" style="position: sticky; top: 0; width: 100vw; height: 100vh; overflow: hidden; contain: strict;">
    <canvas id="hero-viewport" style="width: 100%; height: 100%; display: block;"></canvas>
  </div>
</div>
```

---

## 3. Mapping Scroll Ranges & Target Elements

By default, `ScrollDriver` tracks `window.scrollY`. For sections embedded mid-page, pass a `triggerElement` or custom container:

```typescript
import { Zoetrope } from '@zoetrope/core';

const canvas = document.querySelector<HTMLCanvasElement>('#hero-viewport')!;
const section = document.querySelector<HTMLElement>('.scrolly-section')!;

const engine = new Zoetrope({
  manifest: '/assets/hero/manifest.json',
  canvas,
  renderer: {
    fit: 'cover'
  },
  playback: {
    mode: 'scroll',
    container: window,
    triggerElement: section,
    smoothing: {
      enabled: true,
      tau: 28,
      epsilon: 0.0001
    }
  }
});

await engine.init();
```

---

## 4. Multiple Sequences on One Page

When orchestrating multiple sequences (e.g. background environment + foreground product mask), use `ZoetropeComposition`:

```typescript
import { ZoetropeComposition, CompositionLayerConfig } from '@zoetrope/core';

const canvas = document.querySelector<HTMLCanvasElement>('#composition-viewport')!;

const layers: CompositionLayerConfig[] = [
  {
    id: 'base-track',
    manifest: '/assets/track1/manifest.json',
    scrollRange: [0.0, 0.7],
    zIndex: 1,
    opacity: [
      { progress: 0.0, value: 1.0 },
      { progress: 0.7, value: 0.0, easing: 'easeOut' }
    ]
  },
  {
    id: 'overlay-track',
    manifest: '/assets/track2/manifest.json',
    scrollRange: [0.3, 1.0],
    zIndex: 2,
    mask: {
      type: 'circle',
      x: [{ progress: 0.0, value: 0.5 }],
      y: [{ progress: 0.0, value: 0.5 }],
      radius: [
        { progress: 0.3, value: 0.0 },
        { progress: 0.6, value: 0.5, easing: 'easeInOut' },
        { progress: 1.0, value: 1.0 }
      ]
    }
  }
];

const composition = new ZoetropeComposition({
  canvas,
  layers,
  totalMemoryMb: 256
});

await composition.init();

window.addEventListener('beforeunload', () => composition.destroy());
```

---

## 5. Lazy-Loading Below the Fold

To preserve mobile data and avoid prefetching before the user reaches the section, gate engine initialization behind an `IntersectionObserver`:

```typescript
let engineInstance: Zoetrope | null = null;

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting && !engineInstance) {
      engineInstance = new Zoetrope({
        manifest: '/assets/section2/manifest.json',
        canvas: document.querySelector<HTMLCanvasElement>('#below-fold-canvas')!,
        renderer: { fit: 'cover' }
      });
      engineInstance.init().catch(console.error);
      observer.disconnect();
    }
  }
}, { rootMargin: '200px' });

observer.observe(document.querySelector('.scrolly-section')!);
```

---

## 6. Accessibility & Reduced Motion

The engine automatically respects the `prefers-reduced-motion: reduce` media query. When active:
- Continuous scrub animation and smooth inertia interpolation are paused.
- A single crisp poster frame (the first anchor frame) is held on canvas.
- Telemetry emits `reducedMotion: true`.

---

## 7. Mobile Variant Behavior

The compiler produces responsive variants (`DESKTOP` at 1920x1080, `MOBILE` at 854x480).
- `selectVariant` dynamically evaluates `window.innerWidth`, screen orientation, and `devicePixelRatio`.
- Viewports <= 768px automatically select the `MOBILE` variant, cutting memory overhead by over 70%.
- Two-tier memory cache auto-adjusts budget: 128MB desktop / 48MB mobile.

---

## 8. Cleanup & Lifecycle Teardown (`destroy()`)

In single-page applications (React, Next.js, Vue, Svelte, Astro), unmounting without calling `destroy()` leaks RequestAnimationFrame loops, scroll listeners, and ImageBitmaps.

**Vanilla JS**:
```typescript
window.addEventListener('beforeunload', () => {
  engine.destroy();
});
```

**React Component**:
```tsx
useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const engine = new Zoetrope({
    manifest: manifestUrl,
    canvas,
    renderer: { fit: 'cover' }
  });
  engine.init().catch(console.error);

  return () => {
    engine.destroy(); // Flushes LRU cache, detaches event listeners, closes decoders
  };
}, [manifestUrl]);
```

---

## 9. Checklist: Things That Go Wrong

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Canvas appears stretched or blurry** | CSS width/height missing or conflicting `canvas.width` attributes | Set CSS `width: 100%; height: 100%; display: block;` and omit inline HTML width/height attributes. |
| **Next.js `window is not defined` error** | Canvas / engine executed on Node.js server during SSR | Wrap component in `next/dynamic(() => ..., { ssr: false })`. |
| **Images fail with 404 / CORS error** | Frame paths relative to host domain or CDN missing CORS header | Add `Access-Control-Allow-Origin: *` to edge headers (`_headers`). |
| **Scrubs backwards and refetches everything** | Cache budget too small for sequence length | Ensure `blobBudgetMb: 128` (desktop) is set; the two-tier cache will replay from memory with 0 network calls. |
| **Page height jumps on mobile address bar hide** | Mobile viewport height shifts dynamically (`100vh` vs `100dvh`) | Use `height: 100dvh` for the sticky viewport container. |
| **High error rate in DevTools on fast scrub** | Routine fetch aborts counted as network errors | Harmless: the engine safely aborts stale in-flight fetches when reversing direction. |

