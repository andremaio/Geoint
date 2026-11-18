import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * Ship the small CPU/WASM runtime on the same origin, avoiding cross-origin
 * blob-module imports in Android in-app browsers. The WebGPU/JSEP binaries
 * exceed the Cloudflare Pages 25 MiB asset cap and remain CDN-loaded.
 */
function shipLocalOrtCpuRuntime(): Plugin {
  return {
    name: 'ship-local-ort-cpu-runtime',
    apply: 'build',
    closeBundle() {
      const source = resolve(process.cwd(), 'node_modules/onnxruntime-web/dist');
      const destination = resolve(process.cwd(), 'dist/ort');
      mkdirSync(destination, { recursive: true });
      for (const filename of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) {
        const input = resolve(source, filename);
        if (!existsSync(input)) {
          throw new Error(`Missing ONNX Runtime CPU fallback asset: ${filename}`);
        }
        if (statSync(input).size >= 25 * 1024 * 1024) {
          throw new Error(`ONNX Runtime CPU fallback asset exceeds Cloudflare Pages limit: ${filename}`);
        }
        copyFileSync(input, resolve(destination, filename));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stripUnusedOrtWasmPlugin(), shipLocalOrtCpuRuntime()],
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
