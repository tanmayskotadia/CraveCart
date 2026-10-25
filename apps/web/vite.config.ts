import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.DEV_GATEWAY_ORIGIN ?? 'http://127.0.0.1:4000' },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': process.env.DEV_GATEWAY_ORIGIN ?? 'http://127.0.0.1:4000' },
  },
  build: { sourcemap: false },
});
