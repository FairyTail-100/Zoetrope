---
name: zoetrope-deploy-cloudflare
description: Deploying ZoetropeJS assets to Cloudflare Pages or Workers with immutable frame caching. Use when configuring CDN caching headers, routing rules, or deployment checks.
---

# Cloudflare Pages / Workers Deployment

Hosting frame sequences on Cloudflare edge requires strict cache partitioning: manifests must revalidate quickly, while frame image files must be cached immutably.

## Recommended Cloudflare Path

- **Format**: Individual WebP (`--packing individual`) is the recommended production path. Individual HTTP fetches leverage Cloudflare's tier-1 edge caching seamlessly without chunk range complexity.
- **Cache Invalidation**: Handled via the automatic `?v=<buildhash>` version tag embedded in the manifest's frame templates.

## Cloudflare `_headers` Configuration

Create `public/_headers` in your client project:
```text
# Master manifests: short edge cache + fast browser revalidation
/assets/*/manifest.json
  Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400
  Access-Control-Allow-Origin: *

# Frames: 1-year immutable cache
/assets/*/*.webp
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
```

## Post-Deploy Verification Checklist

Verify your deployed URL using `curl -I`:

1. **Manifest Cache Header**:
   ```bash
   curl -I https://your-site.pages.dev/assets/hero/manifest.json
   # Expect: Cache-Control: public, max-age=60, s-maxage=300...
   ```
2. **Frame Immutable Header**:
   ```bash
   curl -I https://your-site.pages.dev/assets/hero/desktop/frame_0001.webp
   # Expect: Cache-Control: public, max-age=31536000, immutable
   # Expect: cf-cache-status: HIT (on second request)
   ```
3. **CORS Headers**: Ensure `Access-Control-Allow-Origin: *` is present if hosting assets on an external CDN subdomain.
4. **Platform Limit**: Keep total files under 20,000 files per Pages project. If larger, host assets on Cloudflare R2.

## Detailed Reference

For platform limits and Workers routing:
👉 [references/headers-guide.md](references/headers-guide.md)

