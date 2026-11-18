import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { signRemixPhotos } from "./photos";

/*
 * Contract (src/lib/remix/photos.ts, server-only):
 *   signRemixPhotos(supabase, paths) -> Record<path, signedUrl | null>
 * - One createSignedUrls(uniquePaths, 3600) call on supabase.storage.from("remix-photos"), with
 *   the client it is given (the visitor's own session, so the storage select policy decides).
 * - A path Storage will not sign (not approved, missing) becomes null; a failed or throwing call
 *   makes every path null. Never throws. No paths: no call.
 */

const A = "b0000000-0000-4000-8000-000000000002/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
const B = "c0000000-0000-4000-8000-000000000003/7c9e6679-7425-40de-944b-e07fc1f90ae7.webp";

function client(impl: (paths: string[], expiresIn: number) => Promise<unknown>) {
  const createSignedUrls = vi.fn(impl);
  const from = vi.fn((_bucket: string) => ({ createSignedUrls }));
  const supabase = { storage: { from } } as unknown as SupabaseClient;
  return { supabase, from, createSignedUrls };
}

describe("signRemixPhotos", () => {
  it("signs remix photo paths for 1 hour with the given client", async () => {
    const { supabase, from, createSignedUrls } = client(async (paths, expiresIn) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://x.supabase.co/sign/${path}?e=${expiresIn}`, error: null })),
      error: null,
    }));
    const urls = await signRemixPhotos(supabase, [A, B, A]);
    expect(from).toHaveBeenCalledWith("remix-photos");
    expect(from).not.toHaveBeenCalledWith("recipe-images");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    const [paths, expiresIn] = createSignedUrls.mock.calls[0];
    expect([...paths].sort()).toEqual([A, B].sort()); // de-duplicated
    expect(expiresIn).toBe(3600);
    expect(urls).toEqual({
      [A]: `https://x.supabase.co/sign/${A}?e=3600`,
      [B]: `https://x.supabase.co/sign/${B}?e=3600`,
    });

    // nothing to sign: no Storage call
    const empty = client(async () => ({ data: [], error: null }));
    await expect(signRemixPhotos(empty.supabase, [])).resolves.toEqual({});
    expect(empty.createSignedUrls).not.toHaveBeenCalled();
  });

  it("a path that cannot be signed becomes null and shows a placeholder", async () => {
    const partial = client(async (paths) => ({
      data: paths.map((path) =>
        path === B
          ? { path, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }
          : { path, signedUrl: `https://x.supabase.co/sign/${path}`, error: null },
      ),
      error: null,
    }));
    await expect(signRemixPhotos(partial.supabase, [A, B])).resolves.toEqual({
      [A]: `https://x.supabase.co/sign/${A}`,
      [B]: null,
    });

    // an empty signed URL is not a URL either
    const blank = client(async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: "", error: null })), error: null }));
    await expect(signRemixPhotos(blank.supabase, [A])).resolves.toEqual({ [A]: null });

    // the whole call failed, or threw: every path is null, the page still renders
    const failed = client(async () => ({ data: null, error: { message: "storage down" } }));
    await expect(signRemixPhotos(failed.supabase, [A, B])).resolves.toEqual({ [A]: null, [B]: null });
    const threw = client(async () => {
      throw new Error("network");
    });
    await expect(signRemixPhotos(threw.supabase, [A])).resolves.toEqual({ [A]: null });
  });
});
