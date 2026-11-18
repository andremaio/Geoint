import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * @huggingface/transformers configures ONNX Runtime WASM paths to jsDelivr CDN
 * at runtime (`ONNX_ENV.wasm.wasmPaths`), leaving onnxruntime-web's static
 * `new URL("ort-wasm-*.wasm", import.meta.url)` fallback branches dead.
 * Stripping unused >20 MiB .wasm fallback binaries guarantees every file in
 * `dist/` remains safely under Cloudflare Pages' strict 25 MiB per-asset limit.
 */
function stripUnusedOrtWasmPlugin(): Plugin {
  return {
    name: 'strip-unused-ort-wasm',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm-.*\.wasm$/.test(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stripUnusedOrtWasmPlugin()],
  worker: {
    format: 'es',
    plugins: () => [stripUnusedOrtWasmPlugin()],
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'vendor-three';
          if (id.includes('node_modules/maplibre-gl')) return 'vendor-maplibre';
        },
      },
    },
  },
});
