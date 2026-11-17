# Cloudflare CDN Caching Reference

## Complete `_headers` File

Place this file in your static publishing directory (e.g., `public/_headers` or `dist/_headers`):

```text
# Master manifests: Short TTL with stale-while-revalidate
/assets/*/manifest.json
  Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400
  Access-Control-Allow-Origin: *
  Content-Type: application/json; charset=utf-8

# Binary frame images: Immutable 1-year cache
/assets/*/*.webp
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/assets/*/*.avif
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

# Binary pack chunks (if using chunked/range mode)
/assets/*/*.bin
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
```

## Cloudflare Pages Platform Limits

| Limit | Threshold | Recommended Workaround |
| :--- | :--- | :--- |
| Max files per deployment | 20,000 files | If sequence > 5,000 frames x variants, host frame assets in Cloudflare R2 bucket. |
| Max individual file size | 25 MB | Never exceeded by individual frames (~20KB-80KB each). |
| Custom headers file | `_headers` | Placed at root of publish directory. Maximum 100 rules. |

