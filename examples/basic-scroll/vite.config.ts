import { defineConfig, Plugin } from 'vite';
import * as fs from 'node:fs';
import * as path from 'node:path';

function cacheHeadersPlugin(): Plugin {
  const artifactsCustomDir = path.resolve(__dirname, '../../.artifacts/custom');

  const handleCustomArtifacts = (req: any, res: any, next: any) => {
    const rawUrl = req.url || '';
    if (rawUrl.startsWith('/artifacts-custom/')) {
      const cleanPath = rawUrl.replace('/artifacts-custom/', '').split('?')[0];
      const filePath = path.join(artifactsCustomDir, cleanPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === '.json') mime = 'application/json';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.avif') mime = 'image/avif';
        else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.bin') mime = 'application/octet-stream';

        res.setHeader('Content-Type', mime);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (ext === '.json') {
          res.setHeader('Cache-Control', 'public, max-age=60');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    if (/\.(webp|avif|jpg|jpeg|bin)(\?.*)?$/i.test(rawUrl)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/manifest\.json(\?.*)?$/i.test(rawUrl)) {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
    next();
  };

  return {
    name: 'zoetrope-cache-headers',
    configureServer(server) {
      server.middlewares.use(handleCustomArtifacts);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleCustomArtifacts);
    },
  };
}

export default defineConfig({
  plugins: [cacheHeadersPlugin()],
  server: {
    port: 5173,
    open: false,
  },
});
