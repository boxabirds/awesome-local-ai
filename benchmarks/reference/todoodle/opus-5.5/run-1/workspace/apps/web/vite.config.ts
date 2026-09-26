import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const lucideIcons = path.join(path.dirname(require.resolve('lucide-react/package.json')), 'dist/esm/icons');

/**
 * sonner injects its stylesheet with a runtime <style> tag, which the CSP (default-src 'self', no inline
 * styles) blocks. Its CSS is bundled from index.css instead, and the runtime injection is disabled here.
 */
function sonnerWithoutInlineStyles(): Plugin {
  return {
    name: 'sonner-without-inline-styles',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]sonner[\\/]dist[\\/]index\.m?js$/.test(id)) return null;
      return code.replace('function __insertCSS(code) {', 'function __insertCSS(code) {\n  return;');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sonnerWithoutInlineStyles()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      // Radix's scroll lock would inject <style> tags the CSP blocks; its static rules are in scroll-lock.css.
      { find: /^react-style-singleton$/, replacement: path.resolve(import.meta.dirname, './src/lib/cspStyleSingleton.ts') },
      // Direct per-icon imports keep the bundle free of the lucide barrel (bundle-barrel-imports).
      { find: /^lucide-react\/icons\/(.+)$/, replacement: `${lucideIcons}/$1.mjs` },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
