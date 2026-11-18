# Production Deployment & Caching Guide

This document describes the recommended CDN caching headers, edge configurations, and cache-busting strategies for ZoetropeJS animations.

---

## 1. Caching Strategy Overview

ZoetropeJS uses content-hashed URLs and manifest versioning (`?v=<buildhash>`). Frame assets are completely immutable for any given build hash.

| Asset Type | Path / Pattern | `Cache-Control` Header | Rationale |
| :--- | :--- | :--- | :--- |
| **Frame Images / Chunks** | `*.webp`, `*.avif`, `*.jpg`, `*.bin` | `public, max-age=31536000, immutable` | Frames never mutate. CDN and browser can cache forever. |
| **Manifest JSON** | `manifest.json` | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` | Short cache allows instant deployments and rollbacks. |
| **Engine Bundle** | `*.js`, `*.css` | `public, max-age=31536000, immutable` (hashed) | Standard bundled asset caching. |

---

## 2. Server & CDN Configurations

### Netlify (`_headers`)
Create or append to `public/_headers`:
```ini
# Immutable cache for all frame images and chunk archives
/assets/*.webp
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/assets/*.avif
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/assets/*.bin
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

# Short cache for animation manifest
/assets/**/manifest.json
  Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400
  Access-Control-Allow-Origin: *
```

---

### Vercel (`vercel.json`)
```json
{
  "headers": [
    {
      "source": "/assets/(.*)\\.(webp|avif|jpg|jpeg|bin)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        },
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        }
      ]
    },
    {
      "source": "/assets/(.*)manifest\\.json",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400"
        },
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        }
      ]
    }
  ]
}
```

---

### Cloudflare Workers / Cache Rules
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const response = await fetch(request);

    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    if (/\.(webp|avif|jpg|jpeg|bin)(\?.*)?$/i.test(url.pathname)) {
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/manifest\.json(\?.*)?$/i.test(url.pathname)) {
      newHeaders.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
```

---

### Nginx
```nginx
# Immutable frame assets
location ~* \.(webp|avif|jpg|jpeg|bin)$ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header Access-Control-Allow-Origin "*";
    try_files $uri =404;
}

# Dynamic/versioned manifest
location ~* manifest\.json$ {
    expires 60s;
    add_header Cache-Control "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
    add_header Access-Control-Allow-Origin "*";
    try_files $uri =404;
}
```

