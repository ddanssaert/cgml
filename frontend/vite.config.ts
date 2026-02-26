import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import commonjs from 'vite-plugin-commonjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    commonjs(),
    nodePolyfills({
      include: ['fs', 'path', 'util'],
      globals: { process: true, Buffer: true, global: true },
    })
  ],
  optimizeDeps: {
    include: ['cgml-engine/src/simulator', 'cgml-engine/src/loader', 'cgml-engine/src/state']
  }
})
