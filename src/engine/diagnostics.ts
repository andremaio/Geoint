import type { RuntimeCapabilities } from '../types/geoint';

export function detectRuntimeCapabilities(): RuntimeCapabilities {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';

  let webgpu = false;
  if (hasNavigator && 'gpu' in navigator && (navigator as unknown as { gpu?: unknown }).gpu) {
    webgpu = true;
  }

  let webgl = false;
  if (hasWindow && typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      webgl = Boolean(
        canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
          canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
      );
    } catch {
      webgl = false;
    }
  }

  // Probe WebAssembly SIMD support cleanly using minimal valid WASM v128 module
  let wasmSimd = false;
  try {
    if (typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function') {
      wasmSimd = WebAssembly.validate(
        new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
          0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
          0x41, 0x00, 0xfd, 0x0f, 0x00, 0x0b,
        ])
      );
    }
  } catch {
    wasmSimd = false;
  }

  const indexedDb = hasWindow && 'indexedDB' in window;
  const webWorkers = hasWindow && typeof Worker !== 'undefined';
  const reducedMotion =
    hasWindow &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hardwareConcurrency =
    hasNavigator && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;

  const deviceMemoryGb =
    hasNavigator && 'deviceMemory' in navigator
      ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
      : undefined;

  return {
    webgpu,
    webgl,
    wasmSimd,
    indexedDb,
    webWorkers,
    reducedMotion,
    hardwareConcurrency,
    deviceMemoryGb,
  };
}

export function formatErrorDiagnostic(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    const msg = err.message || 'Unknown error';
    if (/abort|cancel/i.test(msg)) return { code: 'ABORTED', message: msg };
    if (/network|fetch|failed to fetch|404|403|cors/i.test(msg)) {
      return { code: 'NETWORK_ERROR', message: msg };
    }
    if (/memory|oom|allocation|array buffer/i.test(msg)) {
      return { code: 'OUT_OF_MEMORY', message: msg };
    }
    if (/webgl|webgpu|context/i.test(msg)) {
      return { code: 'GRAPHICS_UNAVAILABLE', message: msg };
    }
    return { code: 'RUNTIME_ERROR', message: msg };
  }
  return { code: 'UNKNOWN_ERROR', message: String(err) };
}
