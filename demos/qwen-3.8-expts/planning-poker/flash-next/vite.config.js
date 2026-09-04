import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: false,
    proxy: {
      '/ws': {
        target: `ws://localhost:${Number(process.env.WS_PORT) || 8788}`,
        ws: true,
      },
    },
  },
})
