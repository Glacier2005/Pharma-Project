import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8080';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': apiTarget, '/health': apiTarget, '/socket.io': { target: apiTarget, ws: true } } },
  build: {
    chunkSizeWarningLimit: 2000,
  }
})
