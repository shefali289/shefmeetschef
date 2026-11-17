import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Returns the body of the first top-level block whose prelude matches `prelude`. */
function blockBody(source: string, prelude: RegExp): string | null {
  const m = prelude.exec(source);
  if (!m) return null;
  let i = source.indexOf("{", m.index + m[0].length - 1);
  if (i < 0) return null;
  const start = i + 1;
  let depth = 1;
  for (i = start; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  return source.slice(start, i - 1);
}

/** Every block whose prelude matches `prelude` (global regex), as { start, end, body }. */
function blocks(source: string, prelude: RegExp): { start: number; end: number; body: string }[] {
  const out: { start: number; end: number; body: string }[] = [];
  const re = new RegExp(prelude.source, prelude.flags.includes("g") ? prelude.flags : prelude.flags + "g");
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const open = source.indexOf("{", m.index);
    let depth = 1;
    let i = open + 1;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    out.push({ start: m.index, end: i, body: source.slice(open + 1, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

/** Innermost style rules: { selector, decls } (works inside @media too). */
function rules(source: string): { selector: string; decls: string }[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; decls: string }[] = [];
  for (const m of noComments.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), decls: m[2] });
  }
  return out;
}

function withoutBlocks(source: string, prelude: RegExp): string {
  let out = source;
  for (const b of blocks(source, prelude).reverse()) out = out.slice(0, b.start) + out.slice(b.end);
  return out;
}

const REDUCED = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/;
const HOVER = /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{/;
const PRINT = /@media\s+print\s*\{/;

describe("globals.css brand system", () => {
  it("has a prefers-reduced-motion: reduce block that turns motion off", () => {
    const body = blockBody(css, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
    expect(body).not.toBeNull();
    expect(body!.trim().length).toBeGreaterThan(0);
    expect(body).toMatch(/animation|transition|scroll-behavior/);
  });

  it.each(["--color-cocoa", "--color-blush", "--color-cream", "--color-herb"])(
    "defines colour token %s",
    (token) => {
      expect(css).toMatch(new RegExp(`${token}\\s*:\\s*[^;]+;`));
    },
  );

  it.each(["--font-script", "--font-hand", "--font-sans"])("defines font token %s", (token) => {
    expect(css).toMatch(new RegExp(`${token}\\s*:\\s*[^;]+;`));
  });

  it("only hides [data-reveal=\"pending\"], never plain [data-reveal]", () => {
    const hiding = rules(css).filter(
      (r) => r.selector.includes("[data-reveal") && /opacity\s*:\s*0\s*(;|!|$)/.test(r.decls.trim() + ";"),
    );
    expect(hiding.length).toBeGreaterThan(0);
    for (const r of hiding) {
      for (const sel of r.selector.split(",")) {
        expect(sel).toMatch(/\[data-reveal=["']?pending["']?\]/);
      }
    }
  });

  it("has a print block that forces [data-reveal] visible", () => {
    const print = blocks(css, PRINT);
    expect(print.length).toBeGreaterThan(0);
    const inside = print.flatMap((b) => rules(b.body));
    const forced = inside.filter(
      (r) => r.selector.includes("[data-reveal") && /opacity\s*:\s*1\b/.test(r.decls),
    );
    expect(forced.length).toBeGreaterThan(0);
  });

  it(".lift hover rule lives inside @media (hover: hover)", () => {
    const hover = blocks(css, HOVER);
    expect(hover.some((b) => /\.lift:hover/.test(b.body))).toBe(true);
    // Outside hover-capable media (reduced motion may reset it), no sticky hover lift on touch.
    const rest = withoutBlocks(withoutBlocks(css, HOVER), REDUCED);
    expect(rest).not.toMatch(/\.lift:hover/);
  });

  it("scale-in keyframes never start from opacity 0", () => {
    const frames = blocks(css, /@keyframes\s+[\w-]*scale-in[\w-]*\s*\{/);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.body).not.toMatch(/opacity\s*:\s*0\s*(;|\}|!)/);
    }
  });
});
