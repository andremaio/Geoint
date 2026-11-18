import type { ValidationResult } from '../types/geoint';

export const MAX_IMAGE_FILE_BYTES = 45 * 1024 * 1024; // 45 MB safety cap
export const MAX_IMAGE_PIXELS = 64_000_000; // 64 MP cap to prevent browser OOM
export const MIN_IMAGE_DIMENSION = 32;

function detectMagicSignature(bytes: Uint8Array): { signature: string; supported: boolean; mime: string } {
  if (bytes.length < 12) {
    return { signature: 'TRUNCATED', supported: false, mime: 'application/octet-stream' };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { signature: 'JPEG (FF D8 FF)', supported: true, mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { signature: 'PNG (89 50 4E 47)', supported: true, mime: 'image/png' };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { signature: 'WEBP (RIFF/WEBP)', supported: true, mime: 'image/webp' };
  }
  // ISO BMFF / AVIF / HEIC: ....ftyp
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis') {
      return { signature: `AVIF (ftyp${brand})`, supported: true, mime: 'image/avif' };
    }
    if (['heic', 'heix', 'hevc', 'mif1'].includes(brand)) {
      return { signature: `HEIC/HEIF (ftyp${brand})`, supported: false, mime: 'image/heic' };
    }
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { signature: 'GIF', supported: true, mime: 'image/gif' };
  }
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { signature: 'BMP', supported: true, mime: 'image/bmp' };
  }
  // SVG rejection (security: block active XML/SVG payloads disguised as images)
  const headText = new TextDecoder().decode(bytes.slice(0, 256)).trim().toLowerCase();
  if (headText.startsWith('<svg') || headText.includes('<!doctype svg') || headText.startsWith('<?xml')) {
    return { signature: 'SVG/XML (Blocked)', supported: false, mime: 'image/svg+xml' };
  }
  return { signature: 'UNKNOWN', supported: false, mime: 'application/octet-stream' };
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validateAndIngestImage(file: File): Promise<{
  validation: ValidationResult;
  buffer: ArrayBuffer;
}> {
  const warnings: string[] = [];

  if (!file || file.size === 0) {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: file?.type || 'unknown',
        detectedSignature: 'EMPTY',
        fileName: file?.name || 'unnamed',
        fileSizeBytes: 0,
        width: 0,
        height: 0,
        aspectRatio: 0,
        sha256: '',
        warnings,
        error: 'ERR_EMPTY_FILE',
      },
    };
  }

  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: file.type || 'unknown',
        detectedSignature: 'OVERSIZE',
        fileName: file.name,
        fileSizeBytes: file.size,
        width: 0,
        height: 0,
        aspectRatio: 0,
        sha256: '',
        warnings,
        error: 'ERR_FILE_TOO_LARGE',
      },
    };
  }

  // Read exact untouched original bytes for forensic integrity & SHA-256 hashing
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sig = detectMagicSignature(bytes);
  const sha256 = await computeSha256Hex(buffer);

  if (!sig.supported) {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: file.type || sig.mime,
        detectedSignature: sig.signature,
        fileName: file.name,
        fileSizeBytes: file.size,
        width: 0,
        height: 0,
        aspectRatio: 0,
        sha256,
        warnings,
        error: sig.mime === 'image/heic' ? 'ERR_HEIC_UNSUPPORTED' : 'ERR_UNSUPPORTED_SIGNATURE',
      },
    };
  }

  if (file.type && file.type !== sig.mime && !(file.type === 'image/jpg' && sig.mime === 'image/jpeg')) {
    warnings.push(`Declared MIME (${file.type}) differs from binary header (${sig.signature}).`);
  }

  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: sig.mime }));
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: sig.mime,
        detectedSignature: sig.signature,
        fileName: file.name,
        fileSizeBytes: file.size,
        width: 0,
        height: 0,
        aspectRatio: 0,
        sha256,
        warnings,
        error: 'ERR_DECODE_FAILED',
      },
    };
  }

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: sig.mime,
        detectedSignature: sig.signature,
        fileName: file.name,
        fileSizeBytes: file.size,
        width,
        height,
        aspectRatio: width / Math.max(1, height),
        sha256,
        warnings,
        error: 'ERR_DIMENSIONS_TOO_SMALL',
      },
    };
  }

  if (width * height > MAX_IMAGE_PIXELS) {
    return {
      buffer: new ArrayBuffer(0),
      validation: {
        valid: false,
        mimeType: sig.mime,
        detectedSignature: sig.signature,
        fileName: file.name,
        fileSizeBytes: file.size,
        width,
        height,
        aspectRatio: width / height,
        sha256,
        warnings,
        error: 'ERR_PIXEL_BUDGET_EXCEEDED',
      },
    };
  }

  if (width < 224 || height < 224) {
    warnings.push('Low resolution (<224 px): visual geolocation fidelity may be degraded.');
  }

  return {
    buffer,
    validation: {
      valid: true,
      mimeType: sig.mime,
      detectedSignature: sig.signature,
      fileName: file.name,
      fileSizeBytes: file.size,
      width,
      height,
      aspectRatio: Number((width / height).toFixed(4)),
      sha256,
      warnings,
    },
  };
}
