# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.1] - 2026-11-17

### Added
- `@zoetrope/core`: Scroll-driven HTML5 Canvas video playback (`Zoetrope`), multi-layer timeline and mask composition (`ZoetropeComposition`), two-tier memory cache (`DirectionalLRUCache` + `BlobCache`), request-horizon prefetching, and `prefers-reduced-motion` support.
- `@zoetrope/compiler`: `zoetrope` CLI (`compile`, `validate`, `doctor`, `init`) for multi-variant WebP/AVIF/JPEG frame extraction, color-matrix fidelity, anchor sets, and optional CEPK binary packing.
- `@zoetrope/react`: `useZoetrope`, `ZoetropeCanvas`, and SSR-safe `NextZoetropePlayer`.
- `schema/v1.json`: JSON Schema (Draft 2020-12) for Zoetrope v1.0.0 manifests.
- `skills/zoetrope-*`: 7 agent skills with automated validation (`pnpm test:skills`).
