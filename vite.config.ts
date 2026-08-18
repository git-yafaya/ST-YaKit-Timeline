import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    // dist 中还保存设计参考稿，构建不得删除它们。
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: false,
    minify: mode === 'production',
    target: 'esnext',
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        chunkFileNames: '[name].[hash].chunk.js',
        assetFileNames: assetInfo => (assetInfo.name?.endsWith('.css') ? 'index.css' : '[name][extname]'),
      },
    },
  },
}));
