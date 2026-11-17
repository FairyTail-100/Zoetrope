import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as fs from 'node:fs';
import * as path from 'node:path';
import selfsigned from 'selfsigned';

export interface BenchmarkServer {
  protocol: 'http1' | 'http2';
  port: number;
  url: string;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
};

function resolveFilePath(reqUrl: string): string | null {
  const cleanUrl = reqUrl.split('?')[0];
  const relativePath = cleanUrl === '/' ? 'benchmarks/index.html' : cleanUrl.replace(/^\//, '');
  const absPath = path.resolve(relativePath);

  // Security boundary check: stay within workspace
  if (!absPath.startsWith(path.resolve('.'))) {
    return null;
  }

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    return absPath;
  }
  return null;
}

function handleStaticRequest(
  reqPath: string,
  rangeHeader: string | undefined,
  respond: (statusCode: number, headers: Record<string, string | number>, body: Buffer | fs.ReadStream) => void
) {
  const filePath = resolveFilePath(reqPath);
  if (!filePath) {
    respond(404, { 'Content-Type': 'text/plain' }, Buffer.from('Not Found'));
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Handle Range requests (206 Partial Content)
  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace('bytes=', '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

    if (isNaN(start) || isNaN(end) || start >= stat.size || end >= stat.size || start > end) {
      respond(416, { 'Content-Range': `bytes */${stat.size}` }, Buffer.from('Range Not Satisfiable'));
      return;
    }

    const chunkLength = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    respond(
      206,
      {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': chunkLength,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
      stream
    );
    return;
  }

  // Standard 200 OK
  const stream = fs.createReadStream(filePath);
  respond(
    200,
    {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
    stream
  );
}

export async function startBenchmarkServer(protocol: 'http1' | 'http2' = 'http1', port = 4180): Promise<BenchmarkServer> {
  if (protocol === 'http1') {
    const server = http.createServer((req, res) => {
      // CORS & Cross-Origin-Isolation for Performance metrics
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

      handleStaticRequest(req.url || '/', req.headers.range, (status, headers, body) => {
        res.writeHead(status, headers);
        if (Buffer.isBuffer(body)) {
          res.end(body);
        } else {
          body.pipe(res);
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    return {
      protocol: 'http1',
      port,
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  } else {
    // Generate self-signed certificate for local HTTP/2 TLS
    const pems = await selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], { days: 30 });
    const server = http2.createSecureServer({
      key: pems.private,
      cert: pems.cert,
      allowHTTP1: true,
    });

    server.on('session', (session) => {
      session.on('error', () => {
        // Suppress expected client socket disconnects / stream resets on navigation
      });
    });

    server.on('sessionError', () => {
      // Suppress session-level TLS / stream resets
    });

    server.on('stream', (stream, headers) => {
      stream.on('error', () => {
        // Suppress client aborts / resets on test teardown
      });

      const reqPath = headers[':path'] as string || '/';
      const range = headers['range'] as string | undefined;

      handleStaticRequest(reqPath, range, (status, resHeaders, body) => {
        if (stream.closed || stream.destroyed) return;
        try {
          stream.respond({
            ':status': status,
            ...resHeaders,
            'access-control-allow-origin': '*',
          });

          if (Buffer.isBuffer(body)) {
            stream.end(body);
          } else {
            body.pipe(stream);
            body.on('error', () => {
              if (!stream.closed && !stream.destroyed) stream.close();
            });
          }
        } catch {
          // Stream already closed by client
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    return {
      protocol: 'http2',
      port,
      url: `https://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  }
}
