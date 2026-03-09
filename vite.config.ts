import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),           // Tells Vite how to load .wasm files
    topLevelAwait()   // Simplifies the 'init' process for Wasm
  ],
  build: {
    rollupOptions: {
      input: {
        app_redirect: resolve(__dirname, "index.html"),
        cnc_app: resolve(__dirname, "cnc_app.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three-vendor';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor';
          if (id.includes('machine-core/pkg')) return 'machine-core';
        },
      },
    },
  },
})
