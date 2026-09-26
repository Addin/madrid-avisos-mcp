/**
 * Utilidades de foto para create_aviso_from_photo:
 * carga (base64 o ruta local), extracción de GPS EXIF (JPEG),
 * guardado en tmp para su uso posterior con attach_photo,
 * y token de preview para la confirmación humana en dos fases.
 */
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import exifParser from "exif-parser";

export interface PhotoGps {
  lat: number;
  lng: number;
  alt?: number;
}

export interface PhotoInfo {
  width?: number;
  height?: number;
  make?: string;
  model?: string;
  /** ISO 8601 de la toma, si el EXIF la trae. */
  taken_at?: string;
  /** null si la foto no trae GPS (hay que pasar lat/lng a mano). */
  gps: PhotoGps | null;
  bytes: number;
  /** Aviso no fatal (p.ej. PNG/HEIC sin EXIF legible). */
  exif_warning?: string;
}

/** Carga la foto desde base64 (data URL o base64 puro) o desde ruta local. Exige exactamente una vía. */
export async function loadPhotoBuffer(image_base64?: string, image_path?: string): Promise<Buffer> {
  if (image_base64 && image_path) throw new Error("Pasa image_base64 O image_path, no ambos.");
  if (image_base64) {
    const clean = image_base64.replace(/^data:image\/[\w+.-]+;base64,/, "").trim();
    const buf = Buffer.from(clean, "base64");
    if (!buf.length) throw new Error("image_base64 vacío o inválido.");
    return buf;
  }
  if (image_path) return readFile(image_path);
  throw new Error("Falta la foto: pasa image_base64 (remoto) o image_path (local).");
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** Pasa DMS [g,m,s] + ref a decimal con signo. Si ya es número, exif-parser lo da en decimal con signo. */
function toDecimal(val: unknown, ref: unknown, negativeRef: string): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (Array.isArray(val) && val.length >= 2) {
    const [d = 0, m = 0, s = 0] = val.map(Number);
    if ([d, m, s].some((n) => !Number.isFinite(n))) return null;
    let dec = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600;
    if (String(ref ?? "").toUpperCase() === negativeRef) dec = -dec;
    return dec;
  }
  return null;
}

function inRange(n: number | null, min: number, max: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

/** Extrae metadatos + GPS EXIF. Nunca lanza por EXIF ilegible: devuelve gps null y warning. */
export function parsePhoto(buf: Buffer): PhotoInfo {
  const info: PhotoInfo = { gps: null, bytes: buf.length };
  if (!isJpeg(buf)) {
    info.exif_warning = "No es JPEG (EXIF solo soportado en JPEG): sin GPS automático; pasa lat/lng a mano.";
    return info;
  }
  let tags: Record<string, unknown>;
  let imageSize: { height: number; width: number } | undefined;
  try {
    const r = exifParser.create(buf).parse();
    tags = r.tags as Record<string, unknown>;
    imageSize = r.imageSize;
  } catch {
    info.exif_warning = "EXIF ilegible: sin GPS automático; pasa lat/lng a mano.";
    return info;
  }
  if (imageSize) {
    info.width = imageSize.width;
    info.height = imageSize.height;
  }
  if (typeof tags["Make"] === "string") info.make = tags["Make"];
  if (typeof tags["Model"] === "string") info.model = tags["Model"];
  const ts = tags["DateTimeOriginal"] ?? tags["CreateDate"];
  if (typeof ts === "number" && Number.isFinite(ts)) info.taken_at = new Date(ts * 1000).toISOString();

  const lat = toDecimal(tags["GPSLatitude"], tags["GPSLatitudeRef"], "S");
  const lng = toDecimal(tags["GPSLongitude"], tags["GPSLongitudeRef"], "W");
  if (inRange(lat, -90, 90) && inRange(lng, -180, 180)) {
    const gps: PhotoGps = { lat, lng };
    if (typeof tags["GPSAltitude"] === "number" && Number.isFinite(tags["GPSAltitude"])) {
      gps.alt = tags["GPSAltitude"];
    }
    info.gps = gps;
  } else if (tags["GPSLatitude"] !== undefined || tags["GPSLongitude"] !== undefined) {
    info.exif_warning = "El EXIF trae GPS pero fuera de rango; pasa lat/lng a mano.";
  }
  return info;
}

function extFor(buf: Buffer): string {
  if (isJpeg(buf)) return ".jpg";
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return ".png";
  return ".bin";
}

/**
 * Guarda la foto subida en el tmp del servidor para poder referenciarla
 * después con attach_photo (que trabaja con rutas locales).
 */
export async function saveUpload(buf: Buffer): Promise<string> {
  const dir = join(tmpdir(), "madrid-avisos-uploads");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${extFor(buf)}`);
  await writeFile(path, buf);
  return path;
}

/** JSON canónico (claves ordenadas) para que el hash del preview sea estable entre procesos. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** Token que liga una confirmación con el preview exacto que vio el humano. */
export function previewToken(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
