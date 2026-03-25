import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/', // custom domain sits at root
  build: {
    outDir: 'docs',
  },
  server: {
    port: 5175,
    strictPort: true, // error instead of silently picking a different port
  },
});
