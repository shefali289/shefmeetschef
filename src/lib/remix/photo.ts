// Client-safe photo checks for remixes (the remix-photos bucket has the same type and size rules).
import type { PhotoType } from "./types";

/** Biggest photo a remix may use: 5 MB. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** What the photo input accepts. */
export const PHOTO_ACCEPT = Object.keys(EXTENSIONS).join(",");

const WRONG_TYPE = "Please choose a JPEG, PNG or WebP photo.";

export function isPhotoType(type: string): type is PhotoType {
  return Object.hasOwn(EXTENSIONS, type);
}

/** Null when the chosen file is a JPEG, PNG or WebP of 1 byte to 5 MB, else a friendly message. */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  if (!isPhotoType(file.type)) return WRONG_TYPE;
  if (file.size <= 0) return "That photo looks empty. Please choose another one.";
  if (file.size > PHOTO_MAX_BYTES) return "That photo is too big. Please choose one up to 5 MB.";
  return null;
}

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The real image type from the file's first bytes, or null when it is not JPEG, PNG or WebP. */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

/** "<uid>/<uuid>.<ext>" inside the remix-photos bucket. */
export function photoPathFor(userId: string, type: PhotoType, id: string = crypto.randomUUID()): string {
  return `${userId}/${id}.${EXTENSIONS[type]}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OWN_NAME = new RegExp(`^${UUID}\\.(?:jpg|png|webp)$`);

/** True only for "<userId>/<uuid>.(jpg|png|webp)". */
export function isOwnPhotoPath(path: unknown, userId: string): boolean {
  if (typeof path !== "string" || !userId) return false;
  const prefix = `${userId}/`;
  return path.startsWith(prefix) && OWN_NAME.test(path.slice(prefix.length));
}
