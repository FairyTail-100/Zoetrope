import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';

const externalBuiltins = (id) =>
  id.startsWith('node:') || id === 'sharp' || id === 'ffmpeg-static';

await build({
  build: {
    ssr: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        cli: 'src/cli.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: externalBuiltins,
    },
  },
  ssr: {
    noExternal: ['@zoetrope/manifest', '@zoetrope/streaming'],
  },
});

// Ensure dist/cli.js starts with #!/usr/bin/env node
const cliPath = path.resolve('dist/cli.js');
const cliCode = fs.readFileSync(cliPath, 'utf8');
if (!cliCode.startsWith('#!/usr/bin/env node')) {
  fs.writeFileSync(cliPath, `#!/usr/bin/env node\n${cliCode}`, 'utf8');
}

const resolveInternal = {
  name: 'resolve-internal-zoetrope',
  resolveId(source) {
    if (source.startsWith('@zoetrope/')) {
      const pkg = source.slice('@zoetrope/'.length);
      return path.resolve(`../${pkg}/dist/index.d.ts`);
    }
    return null;
  },
};

const bundle = await rollup({
  input: 'src/index.ts',
  external: externalBuiltins,
  plugins: [
    resolveInternal,
    dts({
      respectExternal: false,
    }),
  ],
});

await bundle.write({
  file: 'dist/index.d.ts',
  format: 'es',
});

await bundle.close();
