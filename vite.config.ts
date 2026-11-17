import { defineConfig } from 'vite';

// Relative base so the build works from file://, a sub-path, or inside a Capacitor/Android WebView.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
});
