# @zoetrope/react

React hooks and components (`useZoetrope`, `ZoetropeCanvas`, and SSR-safe `NextZoetropePlayer`) for Zoetrope.

> Note: Astro is provided as a standalone example (`examples/astro`), not a published adapter package.

## Installation

> Not yet published to npm. Build locally with `pnpm pack:all` and install from `dist-release/`:

```bash
pnpm add file:./dist-release/zoetrope-core-0.1.0-rc.1.tgz file:./dist-release/zoetrope-react-0.1.0-rc.1.tgz
```

## Minimal Usage

```tsx
import dynamic from 'next/dynamic';

const NextZoetropePlayer = dynamic(
  () => import('@zoetrope/react').then((m) => m.NextZoetropePlayer),
  { ssr: false }
);

export function Hero() {
  return (
    <NextZoetropePlayer
      options={{
        manifest: '/assets/hero/manifest.json',
        renderer: { fit: 'cover' },
      }}
    />
  );
}
```

## Documentation

- [Root README](../../README.md)
- [Integration Guide](../../documentation/integration-guide.md)
