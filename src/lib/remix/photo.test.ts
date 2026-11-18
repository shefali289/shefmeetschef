import { describe, expect, it } from "vitest";
import { checkPhotoFile, isOwnPhotoPath, photoPathFor, sniffImageType } from "./photo";

/*
 * Contract (src/lib/remix/photo.ts, client-safe, no server imports):
 *   checkPhotoFile({ type, size }) -> null when the file is image/jpeg, image/png or image/webp of
 *     1 byte to 5 MB (5 * 1024 * 1024), otherwise a friendly message naming the rule.
 *   sniffImageType(bytes) -> "image/jpeg" | "image/png" | "image/webp" | null from magic bytes only
 *     (the browser's type and the file name are never trusted).
 *   photoPathFor(userId, type, id = crypto.randomUUID()) -> "<userId>/<id>.(jpg|png|webp)".
 *   isOwnPhotoPath(path, userId) -> true only for "<userId>/<uuid>.(jpg|png|webp)": no bucket
 *     prefix, no sub-folders, no "..", no other user's folder, no other extension.
 */

const MB = 1024 * 1024;
const USER = "b0000000-0000-4000-8000-000000000002";
const OTHER = "c0000000-0000-4000-8000-000000000003";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0, 1, 1]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBPVP8 ", [0, 0, 0, 0]);

describe("remix photo checks", () => {
  it("accepts JPEG, PNG and WebP up to 5 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect({ type, error: checkPhotoFile({ type, size: 200_000 }) }).toEqual({ type, error: null });
      expect({ type, error: checkPhotoFile({ type, size: 5 * MB }) }).toEqual({ type, error: null });
      expect({ type, error: checkPhotoFile({ type, size: 1 }) }).toEqual({ type, error: null });
    }
  });

  it("rejects other types and files over 5 MB with a friendly message", () => {
    const tooBig = checkPhotoFile({ type: "image/jpeg", size: 5 * MB + 1 });
    expect(tooBig).toMatch(/5 ?MB/i);

    for (const type of ["image/gif", "image/svg+xml", "text/html", "image/heic", "application/pdf", ""]) {
      const error = checkPhotoFile({ type, size: 1000 });
      expect({ type, error }).toEqual({ type, error: expect.stringMatching(/JPEG/) });
      expect(error).toMatch(/PNG/);
      expect(error).toMatch(/WebP/i);
    }
    // an empty file is not a photo either
    expect(checkPhotoFile({ type: "image/png", size: 0 })).toEqual(expect.any(String));
    // messages are friendly, not codes
    expect(tooBig).not.toMatch(/error|exception|413|mime/i);
  });

  it("sniffImageType reads JPEG, PNG and WebP magic bytes and rejects GIF, SVG and HTML renamed .jpg", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");

    const rejected: Record<string, Uint8Array> = {
      gif89: bytes("GIF89a", [1, 0, 1, 0]),
      gif87: bytes("GIF87a", [1, 0, 1, 0]),
      svg: bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      xmlSvg: bytes('<?xml version="1.0"?><svg/>'),
      html: bytes("<!DOCTYPE html><html><body>hi</body></html>"),
      htmlWithBom: bytes([0xef, 0xbb, 0xbf], "<html>"),
      riffWave: bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt "),
      truncatedJpeg: bytes([0xff, 0xd8]),
      truncatedPng: bytes([0x89, 0x50, 0x4e]),
      empty: new Uint8Array(0),
    };
    for (const [name, b] of Object.entries(rejected)) {
      expect({ name, type: sniffImageType(b) }).toEqual({ name, type: null });
    }
  });

  it("photoPathFor builds <uid>/<uuid>.<ext>", () => {
    expect(photoPathFor(USER, "image/jpeg", UUID)).toBe(`${USER}/${UUID}.jpg`);
    expect(photoPathFor(USER, "image/png", UUID)).toBe(`${USER}/${UUID}.png`);
    expect(photoPathFor(USER, "image/webp", UUID)).toBe(`${USER}/${UUID}.webp`);

    // a fresh random uuid by default, so two uploads never share a path
    const a = photoPathFor(USER, "image/jpeg");
    const b = photoPathFor(USER, "image/jpeg");
    const shape = new RegExp(`^${USER}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`);
    expect(a).toMatch(shape);
    expect(b).toMatch(shape);
    expect(a).not.toBe(b);
    // and every path it builds is accepted as the user's own
    expect(isOwnPhotoPath(a, USER)).toBe(true);
  });

  it("isOwnPhotoPath accepts only the user's <uuid>.(jpg|png|webp)", () => {
    for (const ext of ["jpg", "png", "webp"]) {
      expect(isOwnPhotoPath(`${USER}/${UUID}.${ext}`, USER)).toBe(true);
    }
    const refused: unknown[] = [
      `${OTHER}/${UUID}.jpg`, // someone else's folder
      `${USER}/${UUID}.gif`,
      `${USER}/${UUID}.jpeg`,
      `${USER}/${UUID}.svg`,
      `${USER}/${UUID}.JPG`,
      `${USER}/${UUID}.jpg.html`,
      `${USER}/garlic.jpg`, // not a uuid name
      `${USER}/${UUID}`,
      `${USER}/sub/${UUID}.jpg`,
      `${USER}/../${OTHER}/${UUID}.jpg`,
      `../${USER}/${UUID}.jpg`,
      `/${USER}/${UUID}.jpg`,
      `remix-photos/${USER}/${UUID}.jpg`, // bucket prefix is not part of the object name
      `${USER}/${UUID}.jpg?download=1`,
      `${USER}//${UUID}.jpg`,
      ` ${USER}/${UUID}.jpg`,
      `${USER}%2F${UUID}.jpg`,
      `${USER}\\${UUID}.jpg`,
      "",
      null,
      undefined,
      42,
      { path: `${USER}/${UUID}.jpg` },
    ];
    for (const path of refused) {
      expect({ path, ok: isOwnPhotoPath(path, USER) }).toEqual({ path, ok: false });
    }
    // no user, no folder
    expect(isOwnPhotoPath(`/${UUID}.jpg`, "")).toBe(false);
    expect(isOwnPhotoPath(`${UUID}.jpg`, "")).toBe(false);
  });
});
