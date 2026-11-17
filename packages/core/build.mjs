import path from 'node:path';
import { build } from 'vite';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';

await build({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
  },
});

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
