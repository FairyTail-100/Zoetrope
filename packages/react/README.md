# @zoetropejs/react

React hooks and components (`useZoetrope`, `ZoetropeCanvas`, and SSR-safe `NextZoetropePlayer`) for ZoetropeJS.

> Note: Astro is provided as a standalone example (`examples/astro`), not a published adapter package.

## Installation

```bash
npm i @zoetropejs/react@next
```

## Minimal Usage

```tsx
import dynamic from 'next/dynamic';

const NextZoetropePlayer = dynamic(
  () => import('@zoetropejs/react').then((m) => m.NextZoetropePlayer),
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
