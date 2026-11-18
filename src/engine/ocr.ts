import { createWorker, PSM, type Page, type Worker as TesseractWorker } from 'tesseract.js';
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

interface ExtractedPhrase {
  text: string;
  confidence: number;
}

function cleanWordText(raw: string): string {
  return raw
    .replace(/^[^a-zA-Z0-9\u00C0-\u024F]+|[^a-zA-Z0-9\u00C0-\u024F]+$/g, '')
    .trim();
}

function isUsefulToken(s: string): boolean {
  if (s.length < 2) return false;
  // Require at least two Latin/alphabetic letters to avoid punctuation/numeric clutter
  return /[a-zA-Z\u00C0-\u024F]{2,}/.test(s);
}

function extractConfidentWordsAndLines(
  page: Page,
  minWordConf: number
): { phrases: ExtractedPhrase[]; lines: string[] } {
  const phrases: ExtractedPhrase[] = [];
  const lines: string[] = [];

  const blocks = page.blocks || [];
  if (blocks.length > 0) {
    for (const block of blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const acceptedWords: Array<{ text: string; conf: number }> = [];
          for (const w of line.words || []) {
            const clean = cleanWordText(w.text || '');
            const conf = Number.isFinite(w.confidence) ? w.confidence : 0;
            const threshold = clean.length >= 6 ? Math.max(40, minWordConf - 6) : minWordConf;
            if (clean && isUsefulToken(clean) && conf >= threshold) {
              acceptedWords.push({ text: clean, conf });
            }
          }
          if (acceptedWords.length > 0) {
            lines.push(acceptedWords.map((x) => x.text).join(' '));
            for (let i = 0; i < acceptedWords.length; i++) {
              const w0 = acceptedWords[i];
              if (w0.text.length >= 3) {
                phrases.push({ text: w0.text, confidence: w0.conf });
              }
              if (i + 1 < acceptedWords.length) {
                const w1 = acceptedWords[i + 1];
                phrases.push({
                  text: `${w0.text} ${w1.text}`,
                  confidence: (w0.conf + w1.conf) / 2,
                });
              }
              if (i + 2 < acceptedWords.length) {
                const w1 = acceptedWords[i + 1];
                const w2 = acceptedWords[i + 2];
                phrases.push({
                  text: `${w0.text} ${w1.text} ${w2.text}`,
                  confidence: (w0.conf + w1.conf + w2.conf) / 3,
                });
              }
            }
          }
        }
      }
    }
  } else if (page.text) {
    // Fallback if blocks were omitted
    const rawWords = page.text
      .split(/[\s,.;:!?()[\]{}"'`/\\|<>@#$%^&*+=~—–_]+/)
      .map(cleanWordText)
      .filter(isUsefulToken);
    if (rawWords.length > 0) lines.push(rawWords.join(' '));
    for (let i = 0; i < rawWords.length; i++) {
      if (rawWords[i].length >= 3) phrases.push({ text: rawWords[i], confidence: 55 });
      if (i + 1 < rawWords.length) {
        phrases.push({ text: `${rawWords[i]} ${rawWords[i + 1]}`, confidence: 55 });
      }
      if (i + 2 < rawWords.length) {
        phrases.push({
          text: `${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]}`,
          confidence: 55,
        });
      }
    }
  }

  return { phrases, lines };
}

function computeOtsuThreshold(lums: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lums.length; i++) {
    hist[lums[i]]++;
  }
  const total = lums.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 120;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

async function buildScenePreprocessCanvases(imageBlob: Blob): Promise<{
  sparseGrayCanvas: HTMLCanvasElement;
  blockBinaryCanvas: HTMLCanvasElement;
} | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(imageBlob);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (srcW <= 0 || srcH <= 0) return null;

    // Canvas 1: Contrast-stretched grayscale scaled cleanly to max 1280px (Sparse street signs)
    const sparseScale = Math.min(1, 1280 / Math.max(srcW, srcH));
    const sw = Math.max(32, Math.round(srcW * sparseScale));
    const sh = Math.max(32, Math.round(srcH * sparseScale));
    const sparseCanvas = document.createElement('canvas');
    sparseCanvas.width = sw;
    sparseCanvas.height = sh;
    const sCtx = sparseCanvas.getContext('2d');
    if (!sCtx) return null;
    sCtx.drawImage(bitmap, 0, 0, sw, sh);
    const sImg = sCtx.getImageData(0, 0, sw, sh);
    const sData = sImg.data;
    const hist = new Uint32Array(256);
    const lums = new Uint8Array(sw * sh);
    for (let i = 0, p = 0; i < sData.length; i += 4, p++) {
      const y = Math.round(0.299 * sData[i] + 0.587 * sData[i + 1] + 0.114 * sData[i + 2]);
      lums[p] = y;
      hist[y]++;
    }

    const total = sw * sh;
    const lowTarget = Math.floor(total * 0.02);
    const highTarget = Math.floor(total * 0.98);
    let cum = 0;
    let low = 0;
    let high = 255;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= lowTarget) {
        low = v;
        break;
      }
    }
    cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= highTarget) {
        high = v;
        break;
      }
    }
    const span = Math.max(16, high - low);
    for (let i = 0, p = 0; i < sData.length; i += 4, p++) {
      const norm = Math.max(0, Math.min(255, Math.round(((lums[p] - low) / span) * 255)));
      sData[i] = norm;
      sData[i + 1] = norm;
      sData[i + 2] = norm;
      sData[i + 3] = 255;
    }
    sCtx.putImageData(sImg, 0, 0);

    // Canvas 2: Compact 560px Otsu-binarized block (rescues giant headline/plaque lettering against textured stone)
    const blockScale = Math.min(1, 560 / Math.max(srcW, srcH));
    const bw = Math.max(32, Math.round(srcW * blockScale));
    const bh = Math.max(32, Math.round(srcH * blockScale));
    const blockCanvas = document.createElement('canvas');
    blockCanvas.width = bw;
    blockCanvas.height = bh;
    const bCtx = blockCanvas.getContext('2d');
    if (!bCtx) return { sparseGrayCanvas: sparseCanvas, blockBinaryCanvas: sparseCanvas };
    bCtx.drawImage(sparseCanvas, 0, 0, bw, bh);
    const bImg = bCtx.getImageData(0, 0, bw, bh);
    const bData = bImg.data;
    const bLums = new Uint8Array(bw * bh);
    for (let i = 0, p = 0; i < bData.length; i += 4, p++) {
      bLums[p] = bData[i];
    }
    const threshold = computeOtsuThreshold(bLums);

    // Ensure dark foreground text on white background (count dark pixels vs light pixels)
    let lightCount = 0;
    for (let p = 0; p < bLums.length; p++) {
      if (bLums[p] > threshold) lightCount++;
    }
    const invertForWhiteTextOnDarkSign = lightCount < bLums.length * 0.4;

    for (let i = 0, p = 0; i < bData.length; i += 4, p++) {
      const isLight = bLums[p] > threshold;
      const outVal = invertForWhiteTextOnDarkSign ? (isLight ? 0 : 255) : isLight ? 255 : 0;
      bData[i] = outVal;
      bData[i + 1] = outVal;
      bData[i + 2] = outVal;
      bData[i + 3] = 255;
    }
    bCtx.putImageData(bImg, 0, 0);

    return { sparseGrayCanvas: sparseCanvas, blockBinaryCanvas: blockCanvas };
  } catch {
    return null;
  } finally {
    bitmap?.close();
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
          onProgress?.(Math.round((m.progress || 0.2) * 35), 'downloading');
        } else if (m.status === 'recognizing text') {
          onProgress?.(Math.min(95, 38 + Math.round((m.progress || 0) * 52)), 'running');
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

    const allPhrases: ExtractedPhrase[] = [];
    const allCleanLines: string[] = [];

    // Pass 1: Standard full-frame scene context
    onProgress?.(40, 'running');
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '150' });
    const pass1 = await worker.recognize(imageBlob, {}, { blocks: true });
    const p1 = extractConfidentWordsAndLines(pass1.data, 46);
    allPhrases.push(...p1.phrases);
    allCleanLines.push(...p1.lines);

    if (!cancelledFlag) {
      const canvases = await buildScenePreprocessCanvases(imageBlob);
      if (canvases && !cancelledFlag) {
        // Pass 2: Sparse text on contrast-normalized grayscale (catches slanted/scattered signs)
        onProgress?.(68, 'running');
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
        const pass2 = await worker.recognize(canvases.sparseGrayCanvas, {}, { blocks: true });
        const p2 = extractConfidentWordsAndLines(pass2.data, 48);
        allPhrases.push(...p2.phrases);
        allCleanLines.push(...p2.lines);

        // Pass 3: Compact binarized block (catches oversized street plaques & stone lettering)
        if (!cancelledFlag) {
          onProgress?.(86, 'running');
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '150' });
          const pass3 = await worker.recognize(canvases.blockBinaryCanvas, {}, { blocks: true });
          const p3 = extractConfidentWordsAndLines(pass3.data, 48);
          allPhrases.push(...p3.phrases);
          allCleanLines.push(...p3.lines);
        }
      }
    }

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

    // Deduplicate phrases retaining highest observed OCR confidence
    const bestConfMap = new Map<string, { display: string; conf: number }>();
    for (const p of allPhrases) {
      const key = p.text.toLowerCase();
      const prev = bestConfMap.get(key);
      if (!prev || p.confidence > prev.conf) {
        bestConfMap.set(key, { display: p.text, conf: p.confidence });
      }
    }

    const sortedTokens = Array.from(bestConfMap.values())
      .sort((a, b) => {
        if (Math.abs(b.conf - a.conf) > 4) return b.conf - a.conf;
        return b.display.length - a.display.length;
      })
      .map((x) => x.display);

    const uniqueLines = Array.from(new Set(allCleanLines.map((l) => l.trim()).filter(Boolean)));
    const rawText = uniqueLines.join('\n').trim() || (pass1.data.text || '').trim();

    const matchedGazetteerPlaces = await matchTokensToGazetteer(sortedTokens, 12);

    return {
      status: 'complete',
      progress: 100,
      language: lang,
      rawText,
      tokens: sortedTokens,
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
