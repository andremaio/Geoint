import { pipeline, RawImage, env } from '@huggingface/transformers';
import type { CulturalClue } from '../types/geoint';
import { selectDistinctiveCulturalClues } from './culturalEvidence';

const MODEL = 'Xenova/clip-vit-base-patch32';
const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';

// Candidate descriptions intentionally include generic counter-examples.
// A comparative CLIP score is NEVER geographic probability or proof of a place.
const CUES: Array<Omit<CulturalClue, 'score'> & { prompt: string }> = [
  { id: 'barcelos-rooster', label: 'Galo de Barcelos', countryCode: 'PT',
    association: 'Portuguese cultural symbol. A depiction can exist outside Barcelos or Portugal.',
    prompt: 'a large colorful Portuguese Barcelos rooster sculpture with a bright red crest and patterned body' },
  { id: 'rooster-general', label: 'Rooster sculpture', association: 'A rooster sculpture may resemble the Portuguese Galo de Barcelos, but roosters occur worldwide and do not prove a town.',
    prompt: 'an ornamental large rooster statue in a public square' },
  { id: 'azulejos', label: 'Azulejo tiles', countryCode: 'PT',
    association: 'Decorative tiles are widespread; this style alone does not identify a town.',
    prompt: 'a building façade decorated with traditional Portuguese blue and white azulejo ceramic tiles' },
  { id: 'belem', label: 'Torre de Belém', countryCode: 'PT',
    association: 'Potential Lisbon landmark; verify the structure with reference photographs.',
    prompt: 'the Belem Tower stone fortress standing on the waterfront in Lisbon' },
  { id: 'eiffel', label: 'Eiffel Tower', countryCode: 'FR',
    association: 'A famous Paris landmark also reproduced as replicas elsewhere.',
    prompt: 'the recognizable Eiffel Tower rising over the city of Paris' },
  { id: 'red-bus', label: 'Red double-decker bus', countryCode: 'GB',
    association: 'Iconic London transport design but also used in other cities.',
    prompt: 'a red London double decker bus traveling through a city street' },
  { id: 'torii', label: 'Torii gate', countryCode: 'JP',
    association: 'Cultural architecture, not proof of a particular location.',
    prompt: 'a traditional Japanese red torii shrine gate outdoors' },
  { id: 'gondola', label: 'Venetian gondola', countryCode: 'IT',
    association: 'An Italian-themed cultural cue that requires location verification.',
    prompt: 'a black Venetian gondola floating along a narrow canal lined with old buildings' },
  { id: 'windmill', label: 'Dutch-style windmill', countryCode: 'NL',
    association: 'Windmill replicas and historic examples occur in multiple countries.',
    prompt: 'a traditional Dutch windmill in a green countryside landscape' },
  { id: 'liberty', label: 'Statue of Liberty', countryCode: 'US',
    association: 'This monument also has small-scale replicas worldwide.',
    prompt: 'the Statue of Liberty holding a torch on its pedestal in New York' },
  { id: 'christ-redeemer', label: 'Christ the Redeemer', countryCode: 'BR',
    association: 'A recognisable statue but this religious form has replicas.',
    prompt: 'the Christ the Redeemer statue with outstretched arms above Rio de Janeiro' },
  { id: 'generic-square', label: 'Generic European square', association: 'Architecture alone may not distinguish neighbouring countries.',
    prompt: 'a European town square with historic buildings and pedestrians' },
  { id: 'christmas', label: 'Christmas street decorations', association: 'Seasonal illumination is not a reliable geographic indicator.',
    prompt: 'a town square at night with colorful Christmas lights and festive decorations' },
  { id: 'street-sign', label: 'Street or place-name sign', association: 'Readable text should be verified with OCR and place-name matching.',
    prompt: 'a street sign showing readable letters and a place name' },
  { id: 'church', label: 'Historic church', association: 'Similar church façades appear across many countries.',
    prompt: 'an old stone church with a bell tower in a town center' },
  { id: 'market', label: 'Outdoor market', association: 'Market stalls are common globally.',
    prompt: 'an outdoor market with food stalls and people in a city square' },
  { id: 'landscape', label: 'Natural landscape', association: 'Natural scenery may lack unique location evidence.',
    prompt: 'a mountain and river landscape with trees and no buildings' },
  { id: 'indoor', label: 'Interior scene', association: 'Indoor scenes are often unsuitable for geographic estimation.',
    prompt: 'the interior of a building with furniture and no outdoor landmarks' },
];

if (env.backends?.onnx?.wasm) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.jsep.mjs`,
    wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm`,
  };
}

self.onmessage = async (event: MessageEvent<{ id: string; buffer: ArrayBuffer; mimeType: string }>) => {
  const { id, buffer, mimeType } = event.data;
  try {
    const classifier = await pipeline('zero-shot-image-classification', MODEL, {
      device: 'wasm',
      dtype: 'q4',
      progress_callback: (p) => {
        const item = p as { status?: string; progress?: number };
        if (item.status === 'progress' && typeof item.progress === 'number') {
          self.postMessage({ id, type: 'progress', percent: Math.max(0, Math.min(98, Math.round(item.progress))) });
        }
      },
    });
    try {
      const img = await RawImage.fromBlob(new Blob([buffer], { type: mimeType }));
      const scores = await classifier(img, CUES.map((c) => c.prompt)) as unknown as Array<{ label: string; score: number }>;
      const byPrompt = new Map(scores.map((item) => [item.label, item.score]));
      const ranked = CUES.map(({ prompt, ...clue }) => ({
        ...clue,
        score: Math.max(0, Number(byPrompt.get(prompt) || 0)),
      })).sort((a, b) => b.score - a.score);
      // Do not turn the winning generic scene prompt into a "cultural finding".
      // A rooster alone is only a possible motif, never a pinpointed location.
      const clues = selectDistinctiveCulturalClues(ranked);
      self.postMessage({ id, type: 'result', clues });
    } finally {
      await classifier.dispose();
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
