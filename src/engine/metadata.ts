import exifr from 'exifr';
import type { ExifMetadataSummary } from '../types/geoint';

function isValidCoord(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // Filter null-island (0, 0) uninitialized GPS headers
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return false;
  return true;
}

function toIsoDate(val: unknown, offsetStr?: string): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString();
  }
  if (typeof val === 'string') {
    const normalized = val.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').trim();
    const candidate = offsetStr ? `${normalized.replace(' ', 'T')}${offsetStr}` : normalized;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return val;
  }
  return undefined;
}

export async function extractImageMetadata(buffer: ArrayBuffer): Promise<ExifMetadataSummary> {
  try {
    const raw = (await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      icc: true,
    })) as Record<string, unknown> | undefined;

    if (!raw || typeof raw !== 'object') {
      return {
        hasExif: false,
        hasGps: false,
        gps: null,
        rawTagsCount: 0,
      };
    }

    const keys = Object.keys(raw);
    const hasGps = isValidCoord(raw.latitude, raw.longitude);
    const offsetStr =
      typeof raw.OffsetTimeOriginal === 'string'
        ? raw.OffsetTimeOriginal
        : typeof raw.OffsetTime === 'string'
          ? raw.OffsetTime
          : undefined;

    const dateTimeOriginal = toIsoDate(
      raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate,
      offsetStr
    );

    let gpsTimestampIso: string | undefined;
    if (raw.GPSDateStamp && raw.GPSTimeStamp) {
      gpsTimestampIso = toIsoDate(`${raw.GPSDateStamp} ${raw.GPSTimeStamp}`, 'Z');
    }

    return {
      hasExif: keys.length > 0,
      hasGps,
      gps: hasGps
        ? {
            lat: Number((raw.latitude as number).toFixed(6)),
            lon: Number((raw.longitude as number).toFixed(6)),
            altitudeMeters:
              typeof raw.GPSAltitude === 'number' && Number.isFinite(raw.GPSAltitude)
                ? Number(raw.GPSAltitude.toFixed(1))
                : undefined,
            imgDirectionDeg:
              typeof raw.GPSImgDirection === 'number' && Number.isFinite(raw.GPSImgDirection)
                ? Number(raw.GPSImgDirection.toFixed(1))
                : undefined,
            timestampIso: gpsTimestampIso,
          }
        : null,
      cameraMake: typeof raw.Make === 'string' ? raw.Make.trim() : undefined,
      cameraModel: typeof raw.Model === 'string' ? raw.Model.trim() : undefined,
      lensModel: typeof raw.LensModel === 'string' ? raw.LensModel.trim() : undefined,
      focalLengthMm:
        typeof raw.FocalLength === 'number' ? Number(raw.FocalLength.toFixed(1)) : undefined,
      focalLength35mm:
        typeof raw.FocalLengthIn35mmFormat === 'number'
          ? Math.round(raw.FocalLengthIn35mmFormat)
          : undefined,
      fNumber: typeof raw.FNumber === 'number' ? Number(raw.FNumber.toFixed(1)) : undefined,
      exposureTimeSec:
        typeof raw.ExposureTime === 'number' ? raw.ExposureTime : undefined,
      iso: typeof raw.ISO === 'number' ? Math.round(raw.ISO) : undefined,
      dateTimeOriginal,
      offsetTimeOriginal: offsetStr,
      software: typeof raw.Software === 'string' ? raw.Software.trim() : undefined,
      imageWidth:
        typeof raw.ExifImageWidth === 'number' ? raw.ExifImageWidth : undefined,
      imageHeight:
        typeof raw.ExifImageHeight === 'number' ? raw.ExifImageHeight : undefined,
      orientation: typeof raw.Orientation === 'number' ? raw.Orientation : undefined,
      colorSpace:
        raw.ColorSpace === 1
          ? 'sRGB'
          : typeof raw.ProfileDescription === 'string'
            ? raw.ProfileDescription
            : undefined,
      rawTagsCount: keys.length,
    };
  } catch {
    return {
      hasExif: false,
      hasGps: false,
      gps: null,
      rawTagsCount: 0,
    };
  }
}
