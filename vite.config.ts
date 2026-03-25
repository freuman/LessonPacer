import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'docs', // GitHub Pages requires 'docs' or root
  },
  server: {
    port: 5175,
    strictPort: true, // error instead of silently picking a different port
  },
});
