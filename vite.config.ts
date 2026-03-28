import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const codingameDeps = Object.keys(pkg.dependencies).filter((d: string) =>
  d.startsWith('@codingame/'),
);

export default defineConfig({
  build: {
    target: 'esnext',
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@editor': path.resolve(__dirname, 'src/editor'),
      '@plugins': path.resolve(__dirname, 'src/plugins'),
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
    dedupe: ['vscode', 'monaco-editor', ...codingameDeps],
  },
  worker: {
    format: 'es',
  },
  plugins: [
    {
      // For language-features extensions which use SharedArrayBuffer
      name: 'configure-response-headers',
      apply: 'serve',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          next();
        });
      },
    },
  ],
  esbuild: {
    minifySyntax: false,
  },
  optimizeDeps: {
    include: [
      ...codingameDeps,
      '@codingame/monaco-vscode-api/extensions',
      '@codingame/monaco-vscode-api/monaco',
      'vscode/localExtensionHost',
      '@vscode/vscode-languagedetection',
    ],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    fs: {
      allow: ['../'],
    },
  },
});
