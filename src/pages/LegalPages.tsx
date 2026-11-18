import React from 'react';
import { ShieldCheck, Scale, BookOpen, Cpu, ArrowLeft } from 'lucide-react';
import type { Language } from '../types/geoint';
import type { AppRoute } from './NavigationHeaderShim';

interface LegalPageProps {
  route: 'methodology' | 'privacy' | 'terms' | 'credits';
  lang: Language;
  onNavigate: (route: AppRoute) => void;
}

export const LegalPage: React.FC<LegalPageProps> = ({ route, lang, onNavigate }) => {
  const pt = lang === 'pt-PT';

  return (
    <main className="prose-container">
      <div style={{ marginBottom: 18 }}>
        <button type="button" className="btn-ghost" onClick={() => onNavigate('home')}>
          <ArrowLeft size={15} />
          {pt ? 'Voltar ao Início' : 'Back to Overview'}
        </button>
      </div>

      {route === 'methodology' && (
        <article className="prose-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-cyan)', marginBottom: 8 }}>
            <Cpu size={18} />
            <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.12em' }}>
              {pt ? 'ARQUITETURA E RIGOR CIENTÍFICO' : 'ARCHITECTURE & SCIENTIFIC RIGOR'}
            </span>
          </div>
          <h1 className="prose-title">
            {pt ? 'Metodologia e Limitações Técnicas' : 'Methodology & Technical Limitations'}
          </h1>
          <p style={{ color: 'var(--ink-secondary)' }}>
            {pt
              ? 'O CRIMNEX GEOINT combina extração forense de metadados, visão computacional geoespacial, reconhecimento ótico de texto local e cálculo astronómico solar inteiramente no navegador do utilizador.'
              : 'CRIMNEX GEOINT combines forensic metadata extraction, visual geospatial AI, local optical character recognition, and solar azimuth math executed inside your browser.'}
          </p>

          <section className="prose-section">
            <h2>{pt ? '1. Hierarquia de Evidências e Classificação' : '1. Evidence Hierarchy & Classification'}</h2>
            <ul>
              <li>
                <strong>{pt ? 'Metadados GPS EXIF' : 'Device EXIF GPS Metadata'}:</strong>{' '}
                {pt
                  ? 'Coordenadas lidas diretamente do cabeçalho do ficheiro original (quando presentes e válidas). Podem ainda assim ter sido editadas ou refletir imprecisão de recetor GPS.'
                  : 'Coordinates extracted directly from original image EXIF IFD headers when present. Still subject to device GPS drift or prior file editing.'}
              </li>
              <li>
                <strong>{pt ? 'Estimativa Visual Corroborada' : 'Corroborated Visual Estimate'}:</strong>{' '}
                {pt
                  ? 'Hipótese visual da rede neuronal apoiada por correspondência independente (ex.: topónimo extraído por OCR local presente no índice GeoNames próximo ou coerência de azimute solar).'
                  : 'Visual neural prediction corroborated by independent evidence (e.g., local OCR place-name match in GeoNames or consistent solar shadow azimuth).'}
              </li>
              <li>
                <strong>{pt ? 'Estimativa Visual Não Verificada' : 'Unverified Visual Estimate'}:</strong>{' '}
                {pt
                  ? 'Aproximação baseada exclusivamente em semelhança visual (GeoCLIP ViT-L/14) contra 100.000 coordenadas globais com agrupamento radial (clustering) e refinamento local.'
                  : 'Visual similarity approximation (GeoCLIP ViT-L/14) against a 100,000-point global gallery with spatial clustering and continuous local coordinate refinement.'}
              </li>
              <li>
                <strong>{pt ? 'Resultado Inconclusivo' : 'Inconclusive Signal'}:</strong>{' '}
                {pt
                  ? 'Quando a entropia espacial é elevada, a afinidade máxima é fraca ou as hipóteses se dispersam por regiões distantes (comum em interiores, texturas genéricas ou imagens sem pistas).'
                  : 'Flagged automatically when spatial dispersion is high, peak embedding similarity is weak, or visual cues are ambiguous (common in indoor scenes or featureless images).'}
              </li>
            </ul>
          </section>

          <section className="prose-section">
            <h2>{pt ? '2. Interpretação das Pontuações' : '2. Score Interpretation (No Fake Precision)'}</h2>
            <p>
              {pt
                ? 'A percentagem apresentada junto de cada candidato representa exclusivamente a partilha relativa de afinidade (softmax) dentro dos principais grupos espaciais da galeria de 100.000 pontos. NÃO é uma probabilidade estatística calibrada de acerto real nem garante precisão métrica. O sistema não inventa raios de erro em metros sem calibração empírica.'
                : 'The percentage shown for each hypothesis represents relative softmax affinity share across the top spatial clusters in the 100k gallery. It is NOT a calibrated probability of ground-truth accuracy, and the platform never fabricates metric confidence intervals.'}
            </p>
          </section>

          <section className="prose-section">
            <h2>{pt ? '3. Funcionalidades Reais vs. Limitações Atuais' : '3. Implemented Capabilities vs. Current Limitations'}</h2>
            <ul>
              <li>
                <strong>{pt ? 'Implementado localmente:' : 'Implemented locally:'}</strong>{' '}
                {pt
                  ? 'Validação binária e hash SHA-256; extração EXIF/GPS/XMP/IPTC; inferência GeoCLIP ONNX (WebGPU/WASM) com agrupamento espacial; geocodificação inversa offline GeoNames (~46.000 cidades); OCR local via Tesseract.js; verificação solar via SunCalc; triangulação manual de azimutes e medição de distâncias; relatório PDF documental.'
                  : 'Binary signature validation & SHA-256 hashing; EXIF/GPS/XMP/IPTC parsing; GeoCLIP ONNX inference (WebGPU/WASM) with spatial clustering; offline GeoNames reverse geocoding (~46,000 cities); local Tesseract.js OCR; SunCalc solar shadow verification; manual bearing-ray triangulation & distance measurement; documentary PDF export.'}
              </li>
              <li>
                <strong>{pt ? 'Pesquisa externa opcional (opt-in):' : 'Optional opt-in external lookup:'}</strong>{' '}
                {pt
                  ? 'Pesquisa de fotografias abertas próximas na Wikimedia Commons enviando apenas coordenadas candidatas selecionadas pelo investigador — nunca a fotografia original.'
                  : 'Nearby open-licensed Wikimedia Commons geosearch sends only the selected candidate coordinates when explicitly requested — never your photograph.'}
              </li>
              <li>
                <strong>{pt ? 'Limitações conhecidas:' : 'Known limitations:'}</strong>{' '}
                {pt
                  ? 'Imagens em interiores, fotografias sem horizonte ou sinalética legível, regiões rurais sub-representadas no conjunto de treino MP-16 e imagens fortemente recortadas reduzem drasticamente a capacidade de localização. Não há deteção automática de manipulação profunda (deepfake) nem correspondência visual automática por base de dados de satélite comercial.'
                  : 'Indoor scenes, photos lacking distinctive architecture or signage, rural areas underrepresented in MP-16 training imagery, and heavy crops substantially reduce localization accuracy. Automated satellite-tile visual matching is omitted due to commercial licensing restrictions on free satellite imagery.'}
              </li>
            </ul>
          </section>

          <section className="prose-section">
            <h2>{pt ? '4. Resultados Empíricos de Referência (Chromium WASM Q4)' : '4. Empirical Benchmark Summary (Chromium WASM Q4)'}</h2>
            <p>
              {pt
                ? 'Ensaio reproduzível efetuado diretamente em navegador Chromium contra o conjunto local de validação (Xenova/geoclip-large-patch14 Q4 + localização FP32 sobre 100.000 coordenadas):'
                : 'Reproducible browser benchmark measured directly in Chromium against the local validation suite (Xenova/geoclip-large-patch14 Q4 vision + FP32 location encoder across 100,000 coordinates):'}
            </p>
            <ul>
              <li>
                <strong>{pt ? 'Cobertura Top-1 (11 cenas exteriores):' : 'Top-1 Localization (11 outdoor test scenes):'}</strong>{' '}
                {pt
                  ? '11/11 (100%) dentro de 25 km; 9/11 (81,8%) abaixo de 1 km (0,12–0,92 km: Coliseu, Torre Eiffel, Taj Mahal, Pão de Açúcar, Ribeira, Moraine Lake, Golden Gate, Cidade do Cabo e Torre de Belém; Shibuya 7,91 km; Skógafoss 24,07 km).'
                  : '11/11 (100%) within 25 km; 9/11 (81.8%) within 1 km (0.12–0.92 km across Colosseum, Eiffel Tower, Taj Mahal, Sugarloaf Mountain, Ribeira Porto, Moraine Lake, Golden Gate Bridge, Cape Town, Torre de Belém; Shibuya 7.91 km; Skógafoss 24.07 km).'}
              </li>
              <li>
                <strong>{pt ? 'Rejeição de Imagens Sem Pistas (2/2):' : 'No-Clue Rejection Accuracy (2/2):'}</strong>{' '}
                {pt
                  ? 'Cena interior (pico logit 6,30; afinidade 1,87%) e gradiente uniforme sem elementos geográficos (pico logit 3,61; afinidade 0,52%) foram corretamente rejeitados como Inconclusivos.'
                  : 'Indoor coffee table (peak logit 6.30, share 1.87%) and featureless gradient (peak logit 3.61, share 0.52%) are cleanly rejected as Inconclusive.'}
              </li>
              <li>
                <strong>{pt ? 'Latência Medida (CPU WASM):' : 'Measured Latency (CPU WASM):'}</strong>{' '}
                {pt
                  ? 'Indexação inicial única das 100.000 coordenadas ~97 s (guardada em cache local IndexedDB); inferência por imagem ~6,2 s (~0,10 s de pesquisa vetorial).'
                  : 'One-time 100k coordinate matrix indexing ~97 s (cached locally in IndexedDB afterwards); per-image visual inference ~6.2 s (~0.10 s vector scan).'}
              </li>
            </ul>
          </section>
        </article>
      )}

      {route === 'privacy' && (
        <article className="prose-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-emerald)', marginBottom: 8 }}>
            <ShieldCheck size={18} />
            <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.12em' }}>
              {pt ? 'PRIVACIDADE POR ARQUITETURA' : 'PRIVACY BY ARCHITECTURE'}
            </span>
          </div>
          <h1 className="prose-title">
            {pt ? 'Privacidade e Tratamento de Evidências' : 'Privacy & Evidence Handling'}
          </h1>
          <section className="prose-section">
            <h2>{pt ? 'Processamento Integralmente Local' : '100% Client-Side Image Processing'}</h2>
            <p>
              {pt
                ? 'As fotografias carregadas no CRIMNEX GEOINT nunca são enviadas para servidores da CRIMNEX nem para APIs de terceiros. Toda a validação binária, cálculo de hash SHA-256, leitura EXIF, inferência neuronal ONNX e OCR decorrem na memória e Web Workers do seu próprio navegador.'
                : 'Photographs loaded into CRIMNEX GEOINT are never uploaded to CRIMNEX servers or third-party AI APIs. File validation, SHA-256 hashing, EXIF parsing, ONNX neural inference, and OCR execute exclusively inside your browser.'}
            </p>
          </section>
          <section className="prose-section">
            <h2>{pt ? 'Integridade do Ficheiro Original' : 'Original File Integrity'}</h2>
            <p>
              {pt
                ? 'O ficheiro original não sofre qualquer recompressão ou alteração antes do cálculo do resumo criptográfico SHA-256 e da leitura de metadados.'
                : 'Original file bytes are read immutably to compute the SHA-256 digest and inspect binary signatures without modification.'}
            </p>
          </section>
          <section className="prose-section">
            <h2>{pt ? 'Sessões Locais e Pedidos Externos' : 'Local Sessions & External Requests'}</h2>
            <ul>
              <li>
                {pt
                  ? 'As sessões guardadas permanecem apenas no armazenamento IndexedDB do seu dispositivo e podem ser eliminadas a qualquer momento.'
                  : 'Saved investigation sessions reside solely in your browser IndexedDB and can be deleted individually or wiped at any time.'}
              </li>
              <li>
                {pt
                  ? 'Os únicos pedidos externos efetuados são o descarregamento público de pesos de modelo (Hugging Face CDN), pacotes OCR (jsDelivr/Tesseract), mosaicos cartográficos vetoriais (OpenFreeMap), elevação 3D opcional (AWS Open Data) e consultas opt-in de coordenadas na Wikimedia Commons.'
                  : 'External requests are strictly limited to downloading public ONNX weights (Hugging Face CDN), optional OCR language packs, vector map tiles (OpenFreeMap), optional 3D elevation tiles (AWS Open Data), and opt-in coordinate-only queries to Wikimedia Commons.'}
              </li>
              <li>
                {pt
                  ? 'Não utilizamos cookies de seguimento, telemetria comportamental nem recolha de fotografias.'
                  : 'Zero tracking cookies, behavioral analytics, or image telemetry are collected.'}
              </li>
            </ul>
          </section>
        </article>
      )}

      {route === 'terms' && (
        <article className="prose-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-amber)', marginBottom: 8 }}>
            <Scale size={18} />
            <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.12em' }}>
              {pt ? 'ENQUADRAMENTO LEGAL E UTILIZAÇÃO' : 'LEGAL TERMS & RESPONSIBLE USE'}
            </span>
          </div>
          <h1 className="prose-title">{pt ? 'Condições de Utilização' : 'Terms of Use'}</h1>
          <section className="prose-section">
            <h2>{pt ? 'Natureza Exploratória' : 'Exploratory Nature of Predictions'}</h2>
            <p>
              {pt
                ? 'O CRIMNEX GEOINT destina-se a investigação OSINT legítima, jornalismo de verificação, análise de património, resposta humanitária e investigação geoespacial. As localizações sugeridas por modelos de IA são hipóteses estatísticas aproximadas e são fornecidas "tal como estão" (as-is), sem garantias de exatidão ou adequação pericial autónoma.'
                : 'CRIMNEX GEOINT is designed for lawful OSINT research, verification journalism, archival geolocation, and geospatial analysis. AI-predicted locations are exploratory hypotheses provided "as-is" without warranty of accuracy or standalone forensic admissibility.'}
            </p>
          </section>
          <section className="prose-section">
            <h2>{pt ? 'Uso Aceitável e Utilização Comercial' : 'Acceptable & Commercial Use'}</h2>
            <p>
              {pt
                ? 'A utilização comercial do CRIMNEX GEOINT é suportada pelo licenciamento permissivo dos seus componentes, sujeita ao cumprimento integral das atribuições de terceiros listadas na página de Créditos e Licenças. É estritamente proibida a utilização da plataforma para perseguição (stalking), assédio, doxxing ou violação de leis de proteção de dados e privacidade.'
                : 'Commercial use of CRIMNEX GEOINT is supported by the permissive licensing of all integrated libraries, models, and datasets, subject to preserving required third-party attributions listed under Credits & Licenses. Use for stalking, harassment, doxxing, or unlawful surveillance is strictly prohibited.'}
            </p>
          </section>
        </article>
      )}

      {route === 'credits' && (
        <article className="prose-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-cyan)', marginBottom: 8 }}>
            <BookOpen size={18} />
            <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.12em' }}>
              {pt ? 'ATRIBUIÇÕES E CONFORMIDADE COMERCIAL' : 'ATTRIBUTIONS & COMMERCIAL COMPLIANCE'}
            </span>
          </div>
          <h1 className="prose-title">
            {pt ? 'Créditos e Licenças Open-Source' : 'Credits, Data Sources & Licenses'}
          </h1>
          <p style={{ color: 'var(--ink-secondary)' }}>
            {pt
              ? 'Todos os modelos, bibliotecas e fontes cartográficas integradas nesta plataforma foram auditados para utilização comercial sem custos obrigatórios.'
              : 'All models, software libraries, and geographic datasets integrated into CRIMNEX GEOINT have been audited for commercial-compatible open licensing.'}
          </p>

          <section className="prose-section">
            <h2>{pt ? 'Modelos de IA e Visão Computacional' : 'AI & Computer Vision Models'}</h2>
            <ul>
              <li>
                <strong>GeoCLIP (<code>Xenova/geoclip-large-patch14</code> &amp; <code>VicenteVivan/geo-clip</code>):</strong> MIT License. Based on OpenAI CLIP ViT-Large/14 (MIT License).
              </li>
              <li>
                <strong>Transformers.js (<code>@huggingface/transformers</code>):</strong> Apache-2.0 License.
              </li>
              <li>
                <strong>ONNX Runtime Web:</strong> MIT License.
              </li>
              <li>
                <strong>Tesseract.js (OCR):</strong> Apache-2.0 License.
              </li>
            </ul>
          </section>

          <section className="prose-section">
            <h2>{pt ? 'Cartografia, Elevação e Dados Geográficos' : 'Cartography, Elevation & Geospatial Data'}</h2>
            <ul>
              <li>
                <strong>MapLibre GL JS:</strong> BSD-3-Clause License.
              </li>
              <li>
                <strong>Vector Basemap Tiles:</strong> OpenFreeMap &copy; OpenMapTiles, Data from OpenStreetMap contributors (ODbL). Commercial use permitted with attribution.
              </li>
              <li>
                <strong>3D Terrain DEM (Optional Layer):</strong> Mapzen / Tilezen Terrarium Terrain Tiles hosted on AWS Open Data (USGS 3DEP, GMTED2010 &amp; SRTM, ArcticDEM [NSF 1043681/1559691/1542736], EU-DEM Copernicus, NOAA ETOPO1, Geoscience Australia, Austria DGM, Canada OGL, INEGI, LINZ, Kartverket, UK Environment Agency).
              </li>
              <li>
                <strong>Offline Gazetteer:</strong> GeoNames (<code>cities5000</code>, <code>countryInfo</code>) licensed under Creative Commons Attribution 4.0 (CC-BY 4.0).
              </li>
              <li>
                <strong>Reference Coastlines:</strong> Natural Earth 110m Vectors (Public Domain / CC0).
              </li>
              <li>
                <strong>Opt-in Visual Reference Imagery:</strong> Wikimedia Commons GeoSearch API (filtered strictly to CC0, Public Domain, CC-BY, and CC-BY-SA items with per-file artist &amp; license credit).
              </li>
            </ul>
          </section>

          <section className="prose-section">
            <h2>{pt ? 'Bibliotecas de Interface, Criptografia e Relatórios' : 'UI, Forensics & Reporting Libraries'}</h2>
            <ul>
              <li><strong>Three.js, Motion, exifr, jsPDF, React:</strong> MIT License.</li>
              <li><strong>SunCalc:</strong> BSD-2-Clause License (Volodymyr Agafonkin).</li>
              <li><strong>Lucide Icons:</strong> ISC License.</li>
              <li><strong>Fonts (Space Grotesk, Inter, JetBrains Mono):</strong> SIL Open Font License 1.1 (self-hosted).</li>
            </ul>
          </section>
        </article>
      )}
    </main>
  );
};
