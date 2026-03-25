import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/LessonPacer/', // required for GitHub Pages subdirectory deployment
  build: {
    outDir: 'docs',
  },
  server: {
    port: 5175,
    strictPort: true, // error instead of silently picking a different port
  },
});
