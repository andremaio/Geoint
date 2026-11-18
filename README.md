# CRIMNEX GEOINT (`geo.crimnex.com`)

Local-first geospatial photograph intelligence platform for the **CRIMNEX Ecosystem**.  
Photographs are validated, hashed (`SHA-256`), inspected for EXIF/GPS, analyzed via computer vision (`GeoCLIP ViT-L/14`), cross-checked via local OCR and solar shadow azimuth math, plotted on vector/3D cartography, and exported to PDF **100% inside the browser** — with zero mandatory backend costs, zero server image uploads, and commercially compatible permissive licensing.

---

## Core Architecture

- **Zero-Cost Client-Side Stack**: No paid APIs, SaaS subscriptions, GPU servers, or credit cards required. All heavy inference runs in browser Web Workers via `@huggingface/transformers` + ONNX Runtime Web (WebGPU when available, automatic WASM SIMD CPU fallback).
- **On-Demand Model Gate & IndexedDB Caching**:
  - Homepage loads only lightweight UI + lazy Three.js interactive hero globe (zero ONNX/MapLibre/OCR/PDF payloads on landing).
  - Visual geolocation (`Xenova/geoclip-large-patch14`) is gated behind explicit user confirmation with selectable precision (`Q4 ~189 MB` or `INT8 ~293 MB` vision + `36 MB` location encoder), byte progress telemetry, and real cancellation support.
  - The 100,000-point global location embedding matrix is computed once and quantized (`Int8`) in IndexedDB (`geoclip_100k_q8_v1`), followed by exact Float32 rescoring of top candidates and iterative `7×7` coarse-to-fine coordinate refinement.
- **Honest Evidence Taxonomy (Never Confusing Logits for Calibrated Confidence)**:
  - `gps_metadata`: Extracted directly from original device EXIF GPS headers.
  - `evidence_corroborated`: Visual model cluster supported by independent OCR gazetteer match, verified investigator mark, or consistent solar azimuth.
  - `visual_estimate`: Unverified neural approximation from `GeoCLIP`.
  - `inconclusive`: Automatic rejection when peak embedding similarity is weak or spatial dispersion is ambiguous (common in indoor scenes and featureless textures).

---

## Implemented Modules

- **Hero & Adaptive Graphics**: Interactive Three.js 3D atmospheric Earth globe (`src/components/GlobeHero.tsx`) with cursor/touch parallax, reduced-motion support, and graceful 2D SVG Natural Earth fallback when WebGL is disabled.
- **Forensic File Ingestion & Integrity (`src/engine/ingest.ts`, `src/engine/metadata.ts`)**: Binary magic-byte validation (blocking disguised SVG/HTML payloads), unmodified Web Crypto `SHA-256` digest, dimension verification, and full `exifr` EXIF/GPS/optics extraction.
- **Spatial Clustering & Refinement (`src/engine/geoclip.worker.ts`, `src/engine/candidates.ts`)**: 50 km radial spatial clustering up to 5 ranked hypotheses, continuous coordinate refinement, ambiguity scoring, and inconclusive filtering.
- **Interactive Cartography (`src/components/MapWorkspace.tsx`, `src/engine/cartography.ts`)**: MapLibre GL JS v6 + OpenFreeMap vector styles (Obsidian & Cartographic themes), 3D Globe view toggle, optional 3D Terrarium terrain relief (`AWS Open Data`), distance/bearing measurement tool, spherical triangulation rays with automatic intersection pin, and offline Natural Earth 110m vector fallback.
- **Local OCR & Offline Gazetteer (`src/engine/ocr.ts`, `src/engine/gazetteer.ts`)**: `tesseract.js` v7 client-side OCR (EN/PT/ES/FR/DE) with adjacent 1/2/3-gram matching against an offline GeoNames dataset (~46,000 cities in `public/data/gazetteer.json`).
- **Solar Azimuth Consistency (`src/engine/solar.ts`)**: Uses `suncalc` v2 astronomical positioning (North-clockwise solar azimuth & refraction-corrected solar altitude) to validate observed shadow directions.
- **Opt-In Open Visual References (`src/engine/wikimedia.ts`)**: Queries nearby open-licensed (`CC0`, `PD`, `CC-BY`, `CC-BY-SA`) photographs via Wikimedia Commons GeoSearch using only selected coordinates — never transmitting investigated images.
- **Report Export & Local Persistence (`src/engine/reportPdf.ts`, `src/engine/sessions.ts`)**: Client-side PDF report generation via `jsPDF` (evidence summary, map snapshot, solar & ambiguity caveats) and IndexedDB session save/restore.

---

## Commercial Licensing Audit

| Component | Source / Library | License | Commercial Use |
| :--- | :--- | :--- | :--- |
| Visual Geolocation AI | `Xenova/geoclip-large-patch14` / `VicenteVivan/geo-clip` | MIT | Permitted (MIT notice) |
| Inference Runtime | `@huggingface/transformers`, `onnxruntime-web` | Apache-2.0 / MIT | Permitted |
| Vector Map Engine & Styles | `maplibre-gl` v6 + OpenFreeMap (`OpenMapTiles`/`OSM`) | BSD-3-Clause / ODbL | Permitted (attribution shown on map & Credits page) |
| 3D Elevation DEM | Mapzen/Tilezen Terrarium (`AWS Open Data`) | Open Data (USGS/Copernicus/SRTM/et al.) | Permitted (attribution preserved) |
| Offline Gazetteer | GeoNames `cities5000` & `countryInfo` | CC-BY 4.0 | Permitted (attribution preserved) |
| Coastline Vectors | Natural Earth 110m | Public Domain / CC0 | Permitted |
| OCR / Solar / EXIF / PDF / 3D | `tesseract.js`, `suncalc`, `exifr`, `jspdf`, `three`, `motion`, `lucide-react` | Apache-2.0 / BSD-2 / MIT / ISC | Permitted |
| Self-Hosted Fonts | Space Grotesk, Inter, JetBrains Mono (`@fontsource`) | OFL-1.1 | Permitted |

Non-commercial models (e.g., `StreetCLIP CC-BY-NC-4.0`) and commercial-restricted satellite tile providers were deliberately excluded.

---

## Local Development & Verification

```bash
npm install
npm run lint         # Oxlint static check (0 errors / 0 warnings)
npm run build        # TypeScript check + production Vite bundle in dist/
npm test             # Vitest unit tests (math, ingest, EXIF, solar azimuth, clustering)
node tests/e2e.mjs   # Full headless Chromium Playwright E2E suite against dist/
```

---

## Cloudflare Pages Deployment (`geo.crimnex.com`)

Every built file inside `dist/` is verified strictly under Cloudflare Pages' **25 MiB per-asset limit** (the largest file is `dist/data/gazetteer.json` at ~2.65 MiB; dead `onnxruntime-web` `.wasm` fallback copies are excluded by `vite.config.ts` while `@huggingface/transformers` loads matching ONNX WASM binaries from jsDelivr CDN).

1. Connect the repository in **Cloudflare Pages** (Framework preset: `Vite`, Build command: `npm run build`, Build output directory: `dist`).
2. `public/_headers` and `public/_redirects` are automatically copied to `dist/` for SPA history fallback, strict CSP, and security headers.
3. Attach custom domain **`geo.crimnex.com`** under Cloudflare Pages → Custom Domains (CNAME managed in Cloudflare DNS).
