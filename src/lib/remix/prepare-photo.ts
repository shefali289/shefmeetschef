// Browser-side photo preparation: resize to 1600 px and re-encode, so photos stay small and
// EXIF (including location) never reaches Storage.
import { checkPhotoFile } from "./photo";
import type { PhotoType } from "./types";

export interface ImageCodec {
  /** Decodes the file; throws when the browser cannot. */
  decode(file: Blob): Promise<{ width: number; height: number; image: unknown }>;
  /** Draws the decoded image at the given size and encodes it (no metadata survives). */
  encode(image: unknown, size: { width: number; height: number }, type: PhotoType): Promise<Blob>;
}

/** Longest side of a prepared photo. */
export const PHOTO_MAX_SIDE = 1600;

/** createImageBitmap and a canvas: drawing drops every bit of metadata. */
const canvasCodec: ImageCodec = {
  async decode(file) {
    const image = await createImageBitmap(file);
    return { width: image.width, height: image.height, image };
  },
  async encode(image, { width, height }, type) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(image as ImageBitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (!blob || blob.type !== type) throw new Error("could not encode");
    return blob;
  },
};

/** PNG stays PNG (transparency); everything else becomes JPEG. */
function outputType(file: File): PhotoType {
  return file.type === "image/png" ? "image/png" : "image/jpeg";
}

export async function preparePhoto(file: File, codec: ImageCodec = canvasCodec): Promise<Blob> {
  try {
    const { width, height, image } = await codec.decode(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));
    const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
    return await codec.encode(image, size, outputType(file));
  } catch (e) {
    // The browser could not redraw it: send the original only if it is itself allowed.
    if (checkPhotoFile(file) === null) return file;
    throw e;
  }
}
