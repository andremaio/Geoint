import type { Language } from '../types/geoint';

export interface Translations {
  brand: {
    name: string;
    domain: string;
    ecosystem: string;
    tagline: string;
  };
  nav: {
    workspace: string;
    methodology: string;
    privacy: string;
    terms: string;
    credits: string;
    backHome: string;
  };
  hero: {
    title: string;
    subtitle: string;
    cta: string;
    telemetryMode: string;
    webglFallbackNote: string;
  };
  workspace: {
    uploadTitle: string;
    uploadSubtitle: string;
    uploadHint: string;
    selectFile: string;
    loadSampleBtn: string;
    recentCases: string;
    clearSessions: string;
    modelGateTitle: string;
    modelGateDesc: string;
    downloadAndRun: string;
    cancelDownload: string;
    skipVisionModel: string;
    modelChoiceQ4: string;
    modelChoiceInt8: string;
    cachedReady: string;
    downloadingModel: string;
    buildingIndex: string;
    runningVision: string;
    clusteringResults: string;
    classificationGps: string;
    classificationCorroborated: string;
    classificationVisual: string;
    classificationInconclusive: string;
    inconclusiveBanner: string;
    ambiguousBanner: string;
    hypothesesTitle: string;
    evidenceTitle: string;
    metadataTab: string;
    ocrTab: string;
    solarTab: string;
    triangulationTab: string;
    referencesTab: string;
    notesTab: string;
    exportPdf: string;
    verifyCandidate: string;
    verifiedBadge: string;
    manualPinMode: string;
    measureMode: string;
    rayMode: string;
    terrain3d: string;
    globeView: string;
    mapThemeObsidian: string;
    mapThemeLiberty: string;
    runOcr: string;
    cancelOcr: string;
    searchWikimedia: string;
    wikimediaPrivacyNote: string;
    noExifFound: string;
    noOcrMatches: string;
    mapOfflineBanner: string;
    switchPhoto: string;
    switchMap: string;
    newAnalysis: string;
    relativeShareLabel: string;
    relativeShareTooltip: string;
    errorInvalidFile: string;
  };
  legal: {
    methodologyTitle: string;
    privacyTitle: string;
    termsTitle: string;
    creditsTitle: string;
  };
}

export const TRANSLATIONS: Record<Language, Translations> = {
  en: {
    brand: {
      name: 'CRIMNEX GEOINT',
      domain: 'geo.crimnex.com',
      ecosystem: 'CRIMNEX Ecosystem',
      tagline: 'Local-first geospatial image intelligence',
    },
    nav: {
      workspace: 'Analyze',
      methodology: 'Methodology',
      privacy: 'Privacy',
      terms: 'Terms',
      credits: 'Credits & Licenses',
      backHome: 'Overview',
    },
    hero: {
      title: 'Every image has a place.',
      subtitle: 'Discover where a photograph was taken using geospatial intelligence.',
      cta: 'Analyze an Image',
      telemetryMode: 'CLIENT-SIDE INFERENCE · ZERO UPLOAD',
      webglFallbackNote: '2D Vector Cartographic Mode (WebGL unavailable or reduced motion)',
    },
    workspace: {
      uploadTitle: 'Drop a photograph to begin investigation',
      uploadSubtitle: 'JPEG, PNG, WebP, or AVIF up to 45 MB. Processed entirely inside your browser.',
      uploadHint: 'Original file bytes remain unmodified; SHA-256 hash and EXIF/GPS are computed locally.',
      selectFile: 'Select Image',
      loadSampleBtn: 'Test Sample (Torre de Belém)',
      recentCases: 'Local Investigation Sessions',
      clearSessions: 'Clear All',
      modelGateTitle: 'Visual Geolocation Engine Ready to Initialize',
      modelGateDesc:
        'GeoCLIP (ViT-L/14 ONNX) runs locally in your browser via WebGPU/WASM and is downloaded once into browser cache. No image ever leaves your device.',
      downloadAndRun: 'Download Model & Run Visual Analysis',
      cancelDownload: 'Cancel',
      skipVisionModel: 'Inspect EXIF / OCR / Map Only',
      modelChoiceQ4: 'Standard Q4 (~189 MB vision + 36 MB location)',
      modelChoiceInt8: 'High-Precision INT8 (~293 MB vision + 36 MB location)',
      cachedReady: 'Model cached locally — instant analysis',
      downloadingModel: 'Downloading ONNX weights...',
      buildingIndex: 'Indexing 100,000 global coordinates...',
      runningVision: 'Extracting visual geolocation embeddings...',
      clusteringResults: 'Clustering spatial hypotheses & refining coordinates...',
      classificationGps: 'Device EXIF GPS Metadata',
      classificationCorroborated: 'Corroborated Visual Estimate',
      classificationVisual: 'Unverified Visual Estimate',
      classificationInconclusive: 'Inconclusive Signal',
      inconclusiveBanner:
        'Insufficient geographic visual signal. The image lacks distinctive regional cues (e.g., indoor scene, generic texture, or ambiguous framing). Hypotheses below are weak exploratory leads only.',
      ambiguousBanner:
        'High spatial ambiguity detected across distant regions. Cross-verify with signage OCR, solar azimuth, or manual reference points.',
      hypothesesTitle: 'Geographic Hypotheses',
      evidenceTitle: 'Forensic & Spatial Evidence',
      metadataTab: 'EXIF & File',
      ocrTab: 'Local OCR',
      solarTab: 'Solar Azimuth',
      triangulationTab: 'Triangulation',
      referencesTab: 'Open Refs',
      notesTab: 'Report & Notes',
      exportPdf: 'Export PDF Report',
      verifyCandidate: 'Mark Verified',
      verifiedBadge: 'Investigator Verified',
      manualPinMode: 'Set Manual Pin',
      measureMode: 'Measure Distance',
      rayMode: 'Add Bearing Ray',
      terrain3d: '3D Terrain',
      globeView: '3D Globe',
      mapThemeObsidian: 'Obsidian',
      mapThemeLiberty: 'Cartographic',
      runOcr: 'Run Local OCR (~4 MB lang pack)',
      cancelOcr: 'Cancel OCR',
      searchWikimedia: 'Search Nearby Open Wikimedia Photos',
      wikimediaPrivacyNote:
        'Privacy notice: clicking sends only the selected candidate coordinates to Wikimedia Commons API. Your photograph is never uploaded.',
      noExifFound: 'No embedded EXIF metadata detected (common after messaging or social re-encoding).',
      noOcrMatches: 'No gazetteer place-name matches found yet.',
      mapOfflineBanner:
        'External vector tiles unavailable — rendered in offline Natural Earth coastline mode.',
      switchPhoto: 'Photo',
      switchMap: 'Map & Leads',
      newAnalysis: 'New Image',
      relativeShareLabel: 'Model Cluster Share',
      relativeShareTooltip:
        'Relative softmax affinity among the top 100k gallery candidates. This is NOT a calibrated probability of ground-truth accuracy or metric error.',
      errorInvalidFile: 'Unsupported or corrupted image file.',
    },
    legal: {
      methodologyTitle: 'Methodology & Technical Limitations',
      privacyTitle: 'Privacy & Evidence Handling',
      termsTitle: 'Terms of Use',
      creditsTitle: 'Credits, Data Sources & Open-Source Licenses',
    },
  },
  'pt-PT': {
    brand: {
      name: 'CRIMNEX GEOINT',
      domain: 'geo.crimnex.com',
      ecosystem: 'Ecossistema CRIMNEX',
      tagline: 'Inteligência geoespacial local em fotografias',
    },
    nav: {
      workspace: 'Analisar',
      methodology: 'Metodologia',
      privacy: 'Privacidade',
      terms: 'Condições',
      credits: 'Créditos e Licenças',
      backHome: 'Início',
    },
    hero: {
      title: 'Every image has a place.',
      subtitle: 'Discover where a photograph was taken using geospatial intelligence.',
      cta: 'Analyze an Image',
      telemetryMode: 'PROCESSAMENTO LOCAL · ZERO ENVIO DE IMAGENS',
      webglFallbackNote: 'Modo Cartográfico Vetorial 2D (WebGL indisponível ou movimento reduzido)',
    },
    workspace: {
      uploadTitle: 'Largue uma fotografia para iniciar a investigação',
      uploadSubtitle: 'JPEG, PNG, WebP ou AVIF até 45 MB. Processamento integral no seu navegador.',
      uploadHint: 'O ficheiro original não é alterado; o hash SHA-256 e os metadados EXIF/GPS são calculados localmente.',
      selectFile: 'Selecionar Fotografia',
      loadSampleBtn: 'Exemplo de Teste (Torre de Belém)',
      recentCases: 'Sessões Locais de Investigação',
      clearSessions: 'Limpar Tudo',
      modelGateTitle: 'Motor de Geolocalização Visual Pronto a Inicializar',
      modelGateDesc:
        'O modelo GeoCLIP (ViT-L/14 ONNX) executa-se localmente via WebGPU/WASM e é descarregado apenas uma vez para a cache do navegador. Nenhuma imagem sai do seu equipamento.',
      downloadAndRun: 'Descarregar Modelo e Analisar',
      cancelDownload: 'Cancelar',
      skipVisionModel: 'Inspecionar Apenas EXIF / OCR / Mapa',
      modelChoiceQ4: 'Padrão Q4 (~189 MB visão + 36 MB localização)',
      modelChoiceInt8: 'Alta Precisão INT8 (~293 MB visão + 36 MB localização)',
      cachedReady: 'Modelo em cache local — análise imediata',
      downloadingModel: 'A descarregar pesos ONNX...',
      buildingIndex: 'A indexar 100.000 coordenadas globais...',
      runningVision: 'A extrair vetores geoespaciais visuais...',
      clusteringResults: 'A agrupar hipóteses espaciais e refinar coordenadas...',
      classificationGps: 'Metadados GPS EXIF do Dispositivo',
      classificationCorroborated: 'Estimativa Visual Corroborada',
      classificationVisual: 'Estimativa Visual Não Verificada',
      classificationInconclusive: 'Resultado Inconclusivo',
      inconclusiveBanner:
        'Sinal geográfico visual insuficiente. A fotografia não apresenta indícios regionais distintivos (ex.: interior, textura genérica ou enquadramento ambíguo). As hipóteses abaixo são meramente exploratórias.',
      ambiguousBanner:
        'Elevada ambiguidade espacial entre regiões distantes. Valide com OCR de placas, azimute solar ou pontos de referência manuais.',
      hypothesesTitle: 'Hipóteses Geográficas',
      evidenceTitle: 'Evidências Forenses e Espaciais',
      metadataTab: 'EXIF e Ficheiro',
      ocrTab: 'OCR Local',
      solarTab: 'Azimute Solar',
      triangulationTab: 'Triangulação',
      referencesTab: 'Referências Abertas',
      notesTab: 'Relatório e Notas',
      exportPdf: 'Exportar Relatório PDF',
      verifyCandidate: 'Marcar como Verificado',
      verifiedBadge: 'Verificado pelo Investigador',
      manualPinMode: 'Definir Ponto Manual',
      measureMode: 'Medir Distância',
      rayMode: 'Traçar Azimute',
      terrain3d: 'Terreno 3D',
      globeView: 'Globo 3D',
      mapThemeObsidian: 'Obsidian',
      mapThemeLiberty: 'Cartográfico',
      runOcr: 'Executar OCR Local (~4 MB idioma)',
      cancelOcr: 'Cancelar OCR',
      searchWikimedia: 'Pesquisar Fotos Abertas Próximas (Wikimedia)',
      wikimediaPrivacyNote:
        'Nota de privacidade: esta pesquisa envia apenas as coordenadas do candidato selecionado à API da Wikimedia Commons. A sua fotografia nunca é enviada.',
      noExifFound: 'Nenhum metadado EXIF detetado (comum após compressão em redes sociais ou mensagens).',
      noOcrMatches: 'Sem correspondências de topónimos no índice geográfico.',
      mapOfflineBanner:
        'Mosaicos vetoriais externos indisponíveis — a apresentar mapa vetorial local Natural Earth.',
      switchPhoto: 'Fotografia',
      switchMap: 'Mapa e Hipóteses',
      newAnalysis: 'Nova Imagem',
      relativeShareLabel: 'Afinidade Relativa do Grupo',
      relativeShareTooltip:
        'Partilha relativa de afinidade entre as 100.000 coordenadas da galeria. NÃO representa probabilidade estatística calibrada nem precisão métrica.',
      errorInvalidFile: 'Ficheiro de imagem incompatível ou corrompido.',
    },
    legal: {
      methodologyTitle: 'Metodologia e Limitações Técnicas',
      privacyTitle: 'Privacidade e Tratamento de Evidências',
      termsTitle: 'Condições de Utilização',
      creditsTitle: 'Créditos, Fontes de Dados e Licenças Open-Source',
    },
  },
};
