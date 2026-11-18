import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import type { OcrExtractionResult } from '../types/geoint';
import { matchTokensToGazetteer } from './gazetteer';

let activeWorker: TesseractWorker | null = null;
let cancelledFlag = false;

export async function cancelLocalOcr(): Promise<void> {
  cancelledFlag = true;
  if (activeWorker) {
    try {
      await activeWorker.terminate();
    } catch {
      // ignore termination race
    }
    activeWorker = null;
  }
}

export async function runLocalOcr(
  imageBlob: Blob,
  lang = 'eng',
  onProgress?: (progress: number, stage: 'downloading' | 'running') => void
): Promise<OcrExtractionResult> {
  cancelledFlag = false;

  try {
    onProgress?.(5, 'downloading');

    const worker = await createWorker(lang, 1, {
      logger: (m) => {
        if (cancelledFlag) return;
        if (m.status === 'loading language traineddata' || m.status === 'initializing api') {
          onProgress?.(Math.round((m.progress || 0.2) * 45), 'downloading');
        } else if (m.status === 'recognizing text') {
          onProgress?.(45 + Math.round((m.progress || 0) * 55), 'running');
        }
      },
    });
    activeWorker = worker;

    if (cancelledFlag) {
      await worker.terminate();
      activeWorker = null;
      return {
        status: 'cancelled',
        progress: 0,
        language: lang,
        rawText: '',
        tokens: [],
        matchedGazetteerPlaces: [],
      };
    }

    onProgress?.(50, 'running');
    const { data } = await worker.recognize(imageBlob);
    await worker.terminate();
    activeWorker = null;

    if (cancelledFlag) {
      return {
        status: 'cancelled',
        progress: 0,
        language: lang,
        rawText: '',
        tokens: [],
        matchedGazetteerPlaces: [],
      };
    }

    const rawText = (data.text || '').trim();
    const rawWords = rawText
      .split(/[\s,.;:!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    const candidates: string[] = [];
    for (let i = 0; i < rawWords.length; i++) {
      if (rawWords[i].length >= 3) candidates.push(rawWords[i]);
      if (i + 1 < rawWords.length) {
        candidates.push(`${rawWords[i]} ${rawWords[i + 1]}`);
      }
      if (i + 2 < rawWords.length) {
        candidates.push(`${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]}`);
      }
    }
    const tokens = Array.from(new Set(candidates));

    const matchedGazetteerPlaces = await matchTokensToGazetteer(tokens, 12);

    return {
      status: 'complete',
      progress: 100,
      language: lang,
      rawText,
      tokens,
      matchedGazetteerPlaces,
    };
  } catch (err) {
    if (activeWorker) {
      try {
        await activeWorker.terminate();
      } catch {
        // ignore
      }
      activeWorker = null;
    }
    if (cancelledFlag) {
      return {
        status: 'cancelled',
        progress: 0,
        language: lang,
        rawText: '',
        tokens: [],
        matchedGazetteerPlaces: [],
      };
    }
    return {
      status: 'error',
      progress: 0,
      language: lang,
      rawText: '',
      tokens: [],
      matchedGazetteerPlaces: [],
      error: err instanceof Error ? err.message : 'OCR execution failed',
    };
  }
}
