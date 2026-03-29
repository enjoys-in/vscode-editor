import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const codingameDeps = Object.keys(pkg.dependencies).filter((d: string) =>
  d.startsWith('@codingame/'),
);

// Separate heavy default-extension packages — exclude them from optimizeDeps
// to avoid pre-bundling large WASM/grammars that eat memory
const defaultExtensions = codingameDeps.filter((d) =>
  d.includes('-default-extension'),
);
const serviceOverrides = codingameDeps.filter(
  (d) => !d.includes('-default-extension'),
);

export default defineConfig(({ mode }) => {
  const inputMap: Record<string, Record<string, string>> = {
    full: { main: path.resolve(__dirname, 'index.html') },
    minimal: { minimal: path.resolve(__dirname, 'minimal.html') },
  };
  const input = inputMap[mode] ?? {
    main: path.resolve(__dirname, 'index.html'),
    minimal: path.resolve(__dirname, 'minimal.html'),
  };

  return {
  build: {
    target: 'esnext',
    rollupOptions: {
      input,
      output: {
        manualChunks: {
          // Split heavy language-feature extensions into separate lazy chunks
          'lang-typescript': ['@codingame/monaco-vscode-typescript-language-features-default-extension'],
          'lang-json': ['@codingame/monaco-vscode-json-language-features-default-extension'],
          'lang-html': ['@codingame/monaco-vscode-html-language-features-default-extension'],
          'lang-css': ['@codingame/monaco-vscode-css-language-features-default-extension'],
          'lang-markdown': ['@codingame/monaco-vscode-markdown-language-features-default-extension'],
          'lang-emmet': ['@codingame/monaco-vscode-emmet-default-extension'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@editor': path.resolve(__dirname, 'src/editor'),
      '@minimal': path.resolve(__dirname, 'src/minimal'),
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
      ...serviceOverrides,
      '@codingame/monaco-vscode-api/extensions',
      '@codingame/monaco-vscode-api/monaco',
      '@codingame/monaco-vscode-api/workbench',
      'vscode/localExtensionHost',
      '@vscode/vscode-languagedetection',
    ],
    exclude: defaultExtensions,
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
};
});
