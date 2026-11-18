import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = process.cwd();
const BASE_URL = 'http://127.0.0.1:4173';
const FIXTURES = path.join(ROOT, 'tests/fixtures');

function logStep(msg) {
  console.log(`\n[E2E] ${msg}`);
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server did not respond at ${url} within ${timeoutMs}ms`);
}

async function buildSyntheticOcrSignPng(outPath) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="360">
    <rect width="100%" height="100%" fill="#ffffff" />
    <rect x="24" y="24" width="852" height="312" rx="16" fill="#0b3b8c" stroke="#111111" stroke-width="8" />
    <text x="450" y="155" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="78" font-weight="700" fill="#ffffff" letter-spacing="4">LISBON 12 km</text>
    <text x="450" y="255" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="44" font-weight="600" fill="#facc15" letter-spacing="2">CASCAIS  28 km</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

async function main() {
  await buildSyntheticOcrSignPng('/tmp/e2e-ocr-sign.png');

  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser;
  let noWebglBrowser;

  const pageErrors = [];
  const consoleErrors = [];
  const ownOriginErrors = [];
  const forbiddenOrtWasmRequests = [];

  try {
    await waitForServer(BASE_URL);
    logStep('Preview server active at ' + BASE_URL);

    const { existsSync } = await import('node:fs');
    const execPath = ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));

    browser = await chromium.launch({
      executablePath: execPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    });

    const page = await context.newPage();

    const homepageAssetUrls = [];
    let captureHomepageRequests = true;

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('[PAGEERROR]', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        consoleErrors.push(txt);
        console.error('[CONSOLE.ERROR]', txt);
      }
    });
    page.on('request', (req) => {
      const url = req.url();
      if (captureHomepageRequests) {
        homepageAssetUrls.push(url);
      }
      if (/\/assets\/ort-wasm-/i.test(url)) {
        forbiddenOrtWasmRequests.push(url);
      }
    });
    page.on('response', (res) => {
      const url = res.url();
      if (url.startsWith(BASE_URL) && res.status() >= 400) {
        ownOriginErrors.push(`${res.status()} ${url}`);
      }
    });

    // ==================== 1. HOMEPAGE & LAZY CHUNK AUDIT ====================
    logStep('1. Testing Homepage hero, 3D WebGL globe, and lazy-chunk isolation');
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });

    await page.getByRole('heading', { name: 'Every image has a place.' }).waitFor({ state: 'visible' });
    await page.getByText('Discover where a photograph was taken using geospatial intelligence.').waitFor({ state: 'visible' });
    const heroBtn = page.locator('#hero-analyze-btn');
    await heroBtn.waitFor({ state: 'visible' });
    assert.equal(await heroBtn.textContent().then((s) => s?.trim()), 'Analyze an Image');

    const globeBox = await page.locator('.hero-globe-layer canvas').boundingBox();
    assert.ok(globeBox && globeBox.width > 400 && globeBox.height > 400, 'Expected Three.js WebGL globe canvas on Homepage');

    await page.getByText('TARGET VECTOR:').waitFor({ state: 'visible' });

    const heavyLeaks = homepageAssetUrls.filter((u) =>
      /vendor-maplibre|vendor-pdf|reportPdf|ocr-|vendor-ocr|geoclip\.worker|AnalysisWorkspace|gazetteer\.json/i.test(u)
    );
    assert.deepEqual(heavyLeaks, [], `Heavy workspace assets leaked on Homepage: ${heavyLeaks.join(', ')}`);
    console.log(`  Homepage loaded ${homepageAssetUrls.length} lightweight assets; heavy chunks isolated cleanly.`);

    captureHomepageRequests = false;

    // Click CTA and verify animated route transition into /analyze
    await heroBtn.click();
    await page.locator('#select-image-btn').waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(new URL(page.url()).pathname, '/analyze');

    // ==================== 2. LANGUAGE SWITCH & LEGAL PAGES ====================
    logStep('2. Testing Legal/Methodology routes and EN <-> PT-PT switch');
    await page.getByRole('button', { name: 'PT', exact: true }).click();
    await page.getByText('Largue uma fotografia para iniciar a investigação').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Metodologia' }).click();
    await page.getByText('Resultados Empíricos de Referência').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Privacidade' }).click();
    await page.getByText('Privacidade e Tratamento').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Créditos e Licenças' }).click();
    await page.getByText('Xenova/geoclip-large-patch14').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await page.locator('#select-image-btn').waitFor({ state: 'visible' });

    // ==================== 3. DISGUISED PAYLOAD BLOCK & INSTANT EXIF GPS ====================
    logStep('3. Testing SVG-as-JPEG forensic rejection & instant EXIF GPS analysis');
    await page.locator('#image-file-input').setInputFiles({
      name: 'disguised.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await page.getByText(/ERR_UNSUPPORTED_SIGNATURE|SVG\/XML/i).waitFor({ state: 'visible' });

    await page.locator('#image-file-input').setInputFiles(path.join(FIXTURES, 'belem_with_gps.jpg'));
    await page.locator('.status-badge.gps').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByText('38.6916° N, 9.2160° W').first().waitFor({ state: 'visible' });
    await page.getByText(/CRIMNEX Lab/).waitFor({ state: 'visible' });
    await page.getByText(/SHA-256:/).first().waitFor({ state: 'visible' });

    // Check MapLibre canvas & mode buttons rendered
    const mapCanvasBox = await page.locator('.workspace-stage canvas.maplibregl-canvas').boundingBox();
    assert.ok(mapCanvasBox && mapCanvasBox.width > 300 && mapCanvasBox.height > 300, 'Expected MapLibre GL canvas');

    // Solar Azimuth tab + interactive adjustment
    await page.getByRole('button', { name: 'Solar Azimuth' }).click();
    await page.getByText(/Sun Altitude:/).waitFor({ state: 'visible' });
    await page.locator('input[type="range"]').fill('10');
    await page.locator('input[type="range"]').dispatchEvent('change');
    await page.getByText(/Expected Shadow Bearing:/).waitFor({ state: 'visible' });

    // Skip-vision check while on EXIF fixture
    await page.getByRole('button', { name: 'Inspect EXIF / OCR / Map Only' }).click();
    await page.locator('#start-model-btn').waitFor({ state: 'hidden' });

    // ==================== 4. SAMPLE TORRE DE BELÉM + REAL GEOCLIP + CANCEL/SAVE/PDF ====================
    logStep('4. Testing sample Torre de Belém, GeoCLIP real inference, IndexedDB save/restore & PDF export');
    await page.getByRole('button', { name: 'New Image' }).click();
    await page.locator('#load-sample-btn').click();
    await page.locator('#start-model-btn').waitFor({ state: 'visible', timeout: 8000 });

    // Click download & run visual model (100% real GeoCLIP ViT-L/14 ONNX + 100k LocationEncoder)
    await page.locator('#start-model-btn').click();
    console.log('  Waiting for real GeoCLIP download, 100k location index & visual inference...');

    // Verify progress bar mounts and later finishes
    await page.locator('.status-badge.visual, .status-badge.corroborated').waitFor({ state: 'visible', timeout: 210000 });
    const top1Text = await page.locator('.workspace-sidebar').textContent();
    console.log('  Top hypotheses snippet:', (top1Text || '').replace(/\s+/g, ' ').slice(0, 420));
    assert.match(top1Text || '', /Lisbon|Belém|Ajuda|Algés|Cascais|Oeiras|Almada/i, 'Expected Top-1 visual hypothesis near Lisbon/Belém');
    assert.match(top1Text || '', /38\.6\d+°\s*N,\s*9\.2\d+°\s*W/i, 'Expected Top-1 coordinates aligned within Lisbon/Belém (38.6x N, 9.2x W)');

    // Verify investigator verification button works
    await page.getByRole('button', { name: 'Mark Verified' }).first().click();
    await page.getByText('Investigator Verified').first().waitFor({ state: 'visible' });

    // Wikimedia Open Reference lookup
    await page.getByRole('button', { name: 'Open Refs' }).click();
    await page.getByRole('button', { name: /Search Nearby Open Wikimedia Photos/i }).click();
    try {
      await page.locator('a[href*="commons.wikimedia.org"]').first().waitFor({ state: 'visible', timeout: 12000 });
      console.log('  Wikimedia Commons nearby georeferenced CC/PD photos loaded.');
    } catch {
      console.log('  Wikimedia lookup completed without thumbnails or skipped cleanly.');
    }

    // Notes, Save Local Session & PDF Export
    await page.getByRole('button', { name: 'Report & Notes' }).click();
    await page.locator('textarea').fill('E2E verified coastal fortification in Belém, Lisbon.');
    await page.getByRole('button', { name: 'Save Local Session' }).click();
    await page.getByText('Saved Locally').waitFor({ state: 'visible', timeout: 5000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator('#export-pdf-btn').click(),
    ]);
    const pdfPath = '/tmp/e2e-geoint-report.pdf';
    await download.saveAs(pdfPath);
    const pdfBytes = await fs.readFile(pdfPath);
    assert.ok(pdfBytes.length > 10000, `Expected PDF > 10KB, got ${pdfBytes.length}`);
    assert.equal(pdfBytes.subarray(0, 5).toString('utf8'), '%PDF-', 'Expected valid %PDF header');
    console.log(`  PDF exported cleanly (${pdfBytes.length} bytes, ${download.suggestedFilename()}).`);

    // Verify IndexedDB session restore
    await page.getByRole('button', { name: 'New Image' }).click();
    await page.getByText(/Local Investigation Sessions \(1\)/).waitFor({ state: 'visible' });
    await page.getByText('torre-de-belem-sample.jpg').click();
    await page.getByText('38.').first().waitFor({ state: 'visible' });

    // ==================== 5. CACHED INFERENCE + INCONCLUSIVE REJECTION ====================
    logStep('5. Testing cached GeoCLIP inference & inconclusive rejection on featureless gradient');
    await page.getByRole('button', { name: 'New Image' }).click();
    const tCacheStart = Date.now();
    await page.locator('#image-file-input').setInputFiles(path.join(FIXTURES, 'featureless_gradient.png'));
    await page.locator('[role="alert"]').waitFor({ state: 'visible', timeout: 45000 });
    const cacheElapsedMs = Date.now() - tCacheStart;
    await page.locator('.status-badge.inconclusive').waitFor({ state: 'visible' });
    console.log(`  Cached inference + inconclusive rejection completed in ${(cacheElapsedMs / 1000).toFixed(2)}s.`);

    // ==================== 6. REAL LOCAL OCR + GEONAMES GAZETTEER MATCH ====================
    logStep('6. Testing model cancel & real client-side Tesseract OCR + GeoNames matching');
    await page.getByRole('button', { name: 'New Image' }).click();
    await page.locator('#image-file-input').setInputFiles('/tmp/e2e-ocr-sign.png');
    const cancelBtn = page.locator('#cancel-model-btn');
    try {
      await cancelBtn.waitFor({ state: 'visible', timeout: 2000 });
      await cancelBtn.click();
    } catch {
      // inference finished before click or awaiting gate
    }
    await page.getByRole('button', { name: 'Local OCR' }).click();
    await page.getByRole('button', { name: /Run Local OCR/i }).click();
    await page.getByText(/lisbon/i).first().waitFor({ state: 'visible', timeout: 60000 });
    await page.getByRole('button', { name: /Lisbon, PT/i }).waitFor({ state: 'visible', timeout: 15000 });
    console.log('  Real Tesseract OCR extracted LISBON sign and linked GeoNames Lisbon, PT.');

    // ==================== 7. OFFLINE VECTOR TILE FALLBACK ====================
    logStep('7. Testing offline Natural Earth coastline fallback when tiles.openfreemap.org is blocked');
    const offlinePage = await context.newPage();
    offlinePage.on('pageerror', (err) => pageErrors.push(`offlinePage: ${err.message}`));
    await offlinePage.route('**tiles.openfreemap.org/**', (route) => route.abort());
    await offlinePage.goto(BASE_URL + '/analyze', { waitUntil: 'networkidle' });
    await offlinePage.locator('#image-file-input').setInputFiles(path.join(FIXTURES, 'belem_with_gps.jpg'));
    await offlinePage.getByText(/External vector tiles unavailable/i).waitFor({ state: 'visible', timeout: 15000 });
    await offlinePage.close();

    // ==================== 8. WEBGL-DISABLED FALLBACK ====================
    logStep('8. Testing WebGL-disabled graceful 2D SVG globe & map fallback');
    noWebglBrowser = await chromium.launch({
      executablePath: execPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-webgl',
        '--disable-webgl2',
        '--disable-3d-apis',
        '--disable-gpu',
      ],
    });
    const noWebglCtx = await noWebglBrowser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      ignoreHTTPSErrors: true,
    });
    const noWebglPage = await noWebglCtx.newPage();
    noWebglPage.on('pageerror', (err) => pageErrors.push(`noWebglPage: ${err.message}`));
    await noWebglPage.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    await noWebglPage.getByText(/2D Vector Cartographic Mode/i).waitFor({ state: 'visible' });
    await noWebglPage.locator('#hero-analyze-btn').click();
    await noWebglPage.locator('#image-file-input').waitFor({ state: 'attached' });
    await noWebglPage.locator('#image-file-input').setInputFiles(path.join(FIXTURES, 'belem_with_gps.jpg'));
    await noWebglPage.getByText(/2D Vector Cartographic Mode/i).waitFor({ state: 'visible' });
    await noWebglCtx.close();
    await noWebglBrowser.close();
    noWebglBrowser = null;

    // ==================== 9. MOBILE VIEWPORT RESPONSIVE CHECK ====================
    logStep('9. Testing mobile viewport (390x844, touch) layout & pane switcher');
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      locale: 'en-US',
      ignoreHTTPSErrors: true,
    });
    const mPage = await mobileCtx.newPage();
    mPage.on('pageerror', (err) => pageErrors.push(`mobilePage: ${err.message}`));
    await mPage.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    await mPage.locator('#hero-analyze-btn').waitFor({ state: 'visible' });

    const homeOverflow = await mPage.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    assert.ok(homeOverflow.scrollW <= homeOverflow.innerW + 1, `Mobile home horizontal overflow: ${JSON.stringify(homeOverflow)}`);

    await mPage.locator('#hero-analyze-btn').click();
    await mPage.locator('#image-file-input').waitFor({ state: 'attached' });
    await mPage.locator('#image-file-input').setInputFiles(path.join(FIXTURES, 'belem_with_gps.jpg'));
    await mPage.getByRole('button', { name: 'Map & Leads' }).waitFor({ state: 'visible' });

    for (const paneName of ['Photo', 'Map & Leads', 'Evidence']) {
      await mPage.getByRole('button', { name: paneName }).click();
      const overflow = await mPage.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      assert.ok(overflow.scrollW <= overflow.innerW + 1, `Mobile overflow on ${paneName}: ${JSON.stringify(overflow)}`);
    }
    await mobileCtx.close();

    // ==================== FINAL AUDIT ====================
    logStep('Asserting zero errors and zero dead ort-wasm asset requests');
    assert.deepEqual(forbiddenOrtWasmRequests, [], `Found forbidden /assets/ort-wasm requests: ${forbiddenOrtWasmRequests.join(', ')}`);
    assert.deepEqual(ownOriginErrors, [], `Found HTTP >= 400 errors on own assets: ${ownOriginErrors.join(', ')}`);
    assert.deepEqual(pageErrors, [], `Found uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Found console.error entries: ${consoleErrors.join(' | ')}`);

    console.log('\n[E2E] ALL 9 FULL-STACK REAL CHROMIUM E2E SCENARIOS PASSED PERFECTLY!');
  } finally {
    if (noWebglBrowser) await noWebglBrowser.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already exited
    }
  }
}

main().catch((err) => {
  console.error('\n[E2E FAILED]', err);
  process.exit(1);
});
