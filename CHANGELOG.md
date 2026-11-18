# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.1] - 2026-11-18

### Changed
- Aligned anchor frame quality resolution (`resolveEncoderQuality`, `jpegQualityToQscale`) with main `compile` defaults (`80` WebP, CRF `32` AVIF, `85` JPEG).

### Added
- `@zoetropejs/core`: Scroll-driven HTML5 Canvas video playback (`Zoetrope`), multi-layer timeline and mask composition (`ZoetropeComposition`), two-tier memory cache (`DirectionalLRUCache` + `BlobCache`), request-horizon prefetching, and `prefers-reduced-motion` support.
- `@zoetropejs/compiler`: `zoetropejs` CLI (`compile`, `validate`, `doctor`) for multi-variant WebP/AVIF/JPEG frame extraction, `bt601` color-matrix handling (versions tested are 8.0.1 (CI, Ubuntu apt) and 9.0.1 (local Windows build); 7.0.2 was tested in earlier CI runs but is no longer exercised; the `>= 6.0` minimum is unverified), encoder availability checks (`libwebp`, `libaom-av1`, `mjpeg`) in `doctor` and `compile`, anchor sets, and optional CEPK binary packing.
- `@zoetropejs/react`: `useZoetrope`, `ZoetropeCanvas`, and SSR-safe `NextZoetropePlayer`.
- `schema/v1.json`: JSON Schema (Draft 2020-12) for ZoetropeJS v1.0.0 manifests.
- `skills/zoetrope-*`: 7 agent skills with automated validation (`pnpm test:skills`).
