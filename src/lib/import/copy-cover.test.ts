import { describe, expect, it, vi } from "vitest";
import { copyCoverToStorage, type CoverUpload } from "./copy-cover";

const PUBLIC = "https://abc.supabase.co/storage/v1/object/public/recipe-images/";

function imageResponse(type: string, bytes = 1024, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": type, "content-length": String(bytes), ...headers },
  });
}

function setup(res: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    typeof res === "function" ? res() : res,
  );
  const upload = vi.fn(async (file: CoverUpload) => `${PUBLIC}${file.path}`);
  return { fetchMock, upload, f: fetchMock as unknown as typeof fetch };
}

describe("copyCoverToStorage", () => {
  it("only fetches https URLs", async () => {
    for (const url of [
      "http://cdninstagram.example/t.jpg",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "not a url",
      "",
    ]) {
      const { fetchMock, upload, f } = setup(imageResponse("image/jpeg"));
      await expect(copyCoverToStorage({ url, slug: "masala-chai", fetch: f, upload }), url).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    }
  });

  it("uploads jpg, png and webp to recipe-images at <slug>.<ext> and returns the public URL", async () => {
    for (const [type, ext] of [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["image/jpeg; charset=binary", "jpg"],
    ] as const) {
      const { fetchMock, upload, f } = setup(imageResponse(type, 2048));
      const url = await copyCoverToStorage({
        url: "https://cdninstagram.example/t/abc.jpg?sig=1",
        slug: "masala-chai",
        fetch: f,
        upload,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(1);
      const file = upload.mock.calls[0][0];
      expect(file.bucket).toBe("recipe-images");
      expect(file.path).toBe(`masala-chai.${ext}`);
      expect(file.contentType).toBe(type.split(";")[0]);
      expect(file.body.byteLength).toBe(2048);
      expect(url).toBe(`${PUBLIC}masala-chai.${ext}`);
    }
  });

  it("rejects non-image content-type", async () => {
    for (const type of ["text/html", "image/svg+xml", "image/gif", "application/octet-stream"]) {
      const { upload, f } = setup(imageResponse(type));
      await expect(
        copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: f, upload }),
        type,
      ).resolves.toBeNull();
      expect(upload).not.toHaveBeenCalled();
    }
  });

  it("rejects images over 5 MB, by header or by actual size", async () => {
    const big = 5 * 1024 * 1024 + 1;
    const byHeader = setup(imageResponse("image/jpeg", 10, { "content-length": String(big) }));
    await expect(
      copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: byHeader.f, upload: byHeader.upload }),
    ).resolves.toBeNull();
    expect(byHeader.upload).not.toHaveBeenCalled();

    const lying = setup(
      () =>
        Promise.resolve(
          new Response(new Uint8Array(big), { status: 200, headers: { "content-type": "image/png" } }),
        ),
    );
    await expect(
      copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: lying.f, upload: lying.upload }),
    ).resolves.toBeNull();
    expect(lying.upload).not.toHaveBeenCalled();
  });

  it("returns null on failure (non-200, network error, upload error)", async () => {
    const notFound = setup(new Response("nope", { status: 404, headers: { "content-type": "image/jpeg" } }));
    await expect(
      copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: notFound.f, upload: notFound.upload }),
    ).resolves.toBeNull();

    const net = setup(() => Promise.reject(new TypeError("fetch failed")));
    await expect(
      copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: net.f, upload: net.upload }),
    ).resolves.toBeNull();

    const up = setup(imageResponse("image/jpeg"));
    up.upload.mockRejectedValueOnce(new Error("storage full"));
    await expect(
      copyCoverToStorage({ url: "https://cdn.example/x", slug: "chai", fetch: up.f, upload: up.upload }),
    ).resolves.toBeNull();
  });

  it("refuses unsafe slugs so the storage path cannot escape", async () => {
    for (const slug of ["../secrets", "a/b", "", "Chai Latte", "x.jpg"]) {
      const { fetchMock, upload, f } = setup(imageResponse("image/jpeg"));
      await expect(copyCoverToStorage({ url: "https://cdn.example/x", slug, fetch: f, upload }), slug).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    }
  });
});
