import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));
const target = process.env.CODEX_MANAGER_URL ?? 'http://127.0.0.1:8055';

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/healthz': { target, changeOrigin: false },
    },
  },
});
