import type { CulturalClue } from '../types/geoint';

let active: Worker | null = null;
let abortPending: (() => void) | null = null;

export function cancelCulturalClueAnalysis(): void {
  active?.terminate();
  active = null;
  abortPending?.();
  abortPending = null;
}

export async function findCulturalClues(
  imageBuffer: ArrayBuffer,
  mimeType: string,
  onProgress?: (percent: number) => void
): Promise<CulturalClue[]> {
  cancelCulturalClueAnalysis();
  const id = `cultural-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const worker = new Worker(new URL('./culturalClues.worker.ts', import.meta.url), { type: 'module' });
  active = worker;

  return new Promise<CulturalClue[]>((resolve, reject) => {
    let finished = false;
    const finish = (result?: CulturalClue[], error?: Error) => {
      if (finished) return;
      finished = true;
      worker.terminate();
      if (active === worker) {
        active = null;
        abortPending = null;
      }
      if (error) reject(error);
      else resolve(result || []);
    };
    abortPending = () => finish(undefined, new Error('Cultural analysis cancelled'));
    worker.onerror = (event) => finish(undefined, new Error(event.message || 'Cultural model worker failed'));
    worker.onmessage = (event: MessageEvent<
      | { id: string; type: 'progress'; percent: number }
      | { id: string; type: 'result'; clues: CulturalClue[] }
      | { id: string; type: 'error'; message: string }
    >) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') onProgress?.(msg.percent);
      else if (msg.type === 'result') finish(msg.clues);
      else finish(undefined, new Error(msg.message));
    };
    const transferable = imageBuffer.slice(0);
    worker.postMessage({ id, buffer: transferable, mimeType }, [transferable]);
  });
}
