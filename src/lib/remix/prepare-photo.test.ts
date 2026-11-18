import { describe, expect, it, vi } from "vitest";
import { preparePhoto, type ImageCodec } from "./prepare-photo";

/*
 * Contract (src/lib/remix/prepare-photo.ts, browser-side, client-safe):
 *   preparePhoto(file, codec?) -> Promise<Blob>
 * - Decodes the photo, scales the longest side down to 1600 px keeping the aspect ratio (never
 *   upscales; sizes are whole pixels) and ALWAYS re-encodes (even small photos), so EXIF and
 *   location data never reach Storage. The encoded type is JPEG, PNG or WebP.
 * - When the browser cannot decode or encode it, the original is kept if it is itself a valid
 *   JPEG/PNG/WebP up to 5 MB; otherwise it rejects.
 * The codec is injected in tests (the default uses createImageBitmap and a canvas).
 */

const MB = 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function photo(type = "image/jpeg", size = 2000, name = "chai.jpg"): File {
  return new File([new Uint8Array(size)], name, { type });
}

function codec(width: number, height: number) {
  const encoded = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])], { type: "image/jpeg" });
  const c = {
    decode: vi.fn(async (_file: Blob) => ({ width, height, image: "decoded-image" as unknown })),
    encode: vi.fn(async (_image: unknown, _size: { width: number; height: number }, _type: string) => encoded),
  };
  return { codec: c as typeof c & ImageCodec, encoded };
}

describe("preparePhoto", () => {
  it("scales the longest side to 1600 px keeping the aspect ratio", async () => {
    const cases: [number, number, number, number][] = [
      [4000, 3000, 1600, 1200], // landscape
      [1200, 4800, 400, 1600], // portrait
      [3000, 3000, 1600, 1600], // square
      [4032, 3024, 1600, 1200],
      [1000, 3000, 533, 1600], // rounds to whole pixels
      [1600, 900, 1600, 900], // already at the limit
      [800, 600, 800, 600], // never upscaled
    ];
    for (const [w, h, ew, eh] of cases) {
      const { codec: c } = codec(w, h);
      const file = photo();
      await preparePhoto(file, c);
      expect(c.decode).toHaveBeenCalledWith(file);
      expect(c.encode).toHaveBeenCalledTimes(1);
      const [image, size, type] = c.encode.mock.calls[0];
      expect(image).toBe("decoded-image");
      expect({ from: [w, h], size }).toEqual({ from: [w, h], size: { width: ew, height: eh } });
      expect(ALLOWED).toContain(type);
    }
  });

  it("always re-encodes so metadata is dropped", async () => {
    // a small photo that needs no resizing is still drawn and re-encoded
    for (const type of ALLOWED) {
      const { codec: c, encoded } = codec(640, 480);
      const file = photo(type, 3000, `small.${type.split("/")[1]}`);
      const out = await preparePhoto(file, c);
      expect(c.encode).toHaveBeenCalledTimes(1);
      expect(c.encode.mock.calls[0][1]).toEqual({ width: 640, height: 480 });
      expect(out).not.toBe(file);
      expect(out.size).toBe(encoded.size);
      expect(ALLOWED).toContain(out.type);
    }
  });

  it("keeps a valid original when the browser cannot decode it", async () => {
    const cannotDecode = {
      decode: vi.fn(async () => {
        throw new Error("The source image could not be decoded.");
      }),
      encode: vi.fn(async () => new Blob()),
    } as unknown as ImageCodec;

    const jpeg = photo("image/jpeg", 2 * MB);
    await expect(preparePhoto(jpeg, cannotDecode)).resolves.toBe(jpeg);
    const webp = photo("image/webp", 100, "x.webp");
    await expect(preparePhoto(webp, cannotDecode)).resolves.toBe(webp);

    // decoding worked but encoding failed: same fallback
    const cannotEncode = {
      decode: vi.fn(async () => ({ width: 4000, height: 3000, image: {} })),
      encode: vi.fn(async () => {
        throw new Error("toBlob failed");
      }),
    } as unknown as ImageCodec;
    const png = photo("image/png", 1000, "x.png");
    await expect(preparePhoto(png, cannotEncode)).resolves.toBe(png);

    // an original that is not allowed (wrong type or over 5 MB) is not kept
    await expect(preparePhoto(photo("image/gif", 1000, "x.gif"), cannotDecode)).rejects.toThrow();
    await expect(preparePhoto(photo("image/heic", 1000, "x.heic"), cannotDecode)).rejects.toThrow();
    await expect(preparePhoto(photo("image/jpeg", 5 * MB + 1), cannotDecode)).rejects.toThrow();
  });
});
