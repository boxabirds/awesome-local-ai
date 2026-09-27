import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { writeGeneratedCss } from './scripts/build-tokens';

/** Regenerates tokens.css and constants.css from packages/shared before every build. */
function generatedCss(): Plugin {
  return { name: 'todoodle-generated-css', buildStart: () => void writeGeneratedCss() };
}

export default defineConfig({
  plugins: [generatedCss(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^lucide-react\/icons\/(.+)$/, replacement: 'lucide-react/dist/esm/icons/$1.mjs' },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
