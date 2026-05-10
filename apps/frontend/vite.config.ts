import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18792',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:18792',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:18793',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
