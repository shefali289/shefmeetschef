import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import Reveal from "./Reveal";

type IOCallback = (entries: Partial<IntersectionObserverEntry>[], observer: unknown) => void;

let observers: { callback: IOCallback; elements: Element[]; disconnect: ReturnType<typeof vi.fn> }[];

class MockIntersectionObserver {
  callback: IOCallback;
  elements: Element[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
  constructor(callback: IOCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(el: Element) {
    this.elements.push(el);
  }
}

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion") && query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** Places every element at `top` px from the viewport top (jsdom has no layout). */
function placeAt(top: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 200,
    left: 0,
    right: 300,
    width: 300,
    height: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

const BELOW_FOLD = () => window.innerHeight + 500;

/**
 * Renders into a container watched by a MutationObserver. `history(el)` returns every value the
 * element's data-reveal attribute has had, oldest first (the first one is the initial render).
 */
function renderWatched(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mo = new MutationObserver(() => {});
  mo.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-reveal"],
    attributeOldValue: true,
  });
  const records: MutationRecord[] = [];
  const result = render(ui, { container });
  const history = (el: Element) => {
    records.push(...mo.takeRecords());
    const old = records.filter((r) => r.target === el).map((r) => r.oldValue);
    return [...old, el.getAttribute("data-reveal")];
  };
  return { ...result, history, stop: () => mo.disconnect() };
}

function revealRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-reveal]");
  expect(el).not.toBeNull();
  return el!;
}

beforeEach(() => {
  observers = [];
  mockMatchMedia(false);
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Reveal", () => {
  it("renders children", () => {
    render(
      <Reveal as="section" className="extra">
        <p>Masala chai</p>
      </Reveal>,
    );
    const child = screen.getByText("Masala chai");
    expect(child).toBeInTheDocument();
    const root = child.closest("[data-reveal]") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.tagName).toBe("SECTION");
    expect(root.className).toContain("extra");
  });

  it("adds the revealed state when it intersects", () => {
    placeAt(BELOW_FOLD());
    const { container } = render(
      <Reveal delay={120}>
        <p>Card</p>
      </Reveal>,
    );
    const root = revealRoot(container);
    // Below the fold: hidden (pending) until it scrolls into view.
    expect(root).toHaveAttribute("data-reveal", "pending");
    expect(root).not.toHaveAttribute("data-revealed", "true");
    const observer = observers.find((o) => o.elements.includes(root));
    expect(observer).toBeDefined();

    // Not intersecting yet: stays hidden.
    act(() => observer!.callback([{ isIntersecting: false, target: root, intersectionRatio: 0 }], observer));
    expect(root).toHaveAttribute("data-reveal", "pending");
    expect(root).not.toHaveAttribute("data-revealed", "true");

    act(() => observer!.callback([{ isIntersecting: true, target: root, intersectionRatio: 1 }], observer));
    expect(root).not.toHaveAttribute("data-reveal", "pending");
    expect(root).toHaveAttribute("data-revealed", "true");
  });

  it("never hides content in the server render (before effects run)", () => {
    const html = renderToString(
      <Reveal as="section" delay={90}>
        <p>Server chai</p>
      </Reveal>,
    );
    expect(html).toContain("Server chai");
    expect(html).toContain("data-reveal");
    expect(html).not.toMatch(/data-reveal="pending"/);
  });

  it("above the fold: revealed immediately on mount and never set pending", () => {
    placeAt(10);
    const { container, history, stop } = renderWatched(
      <Reveal>
        <p>Hero card</p>
      </Reveal>,
    );
    const root = revealRoot(container);
    expect(root).not.toHaveAttribute("data-reveal", "pending");
    expect(root).toHaveAttribute("data-revealed", "true");
    expect(history(root)).not.toContain("pending");
    stop();
  });

  it("below the fold: set pending after mount, then revealed when it intersects", () => {
    placeAt(BELOW_FOLD());
    const { container, history, stop } = renderWatched(
      <Reveal>
        <p>Lower card</p>
      </Reveal>,
    );
    const root = revealRoot(container);
    expect(root).toHaveAttribute("data-reveal", "pending");
    // The very first committed value is not pending (matches the server render).
    expect(history(root)[0]).not.toBe("pending");
    const observer = observers.find((o) => o.elements.includes(root))!;
    expect(observer).toBeDefined();
    act(() => observer.callback([{ isIntersecting: true, target: root, intersectionRatio: 1 }], observer));
    expect(root).not.toHaveAttribute("data-reveal", "pending");
    expect(root).toHaveAttribute("data-revealed", "true");
    stop();
  });

  it("disconnects the observer on unmount", () => {
    placeAt(BELOW_FOLD());
    const { container, unmount } = render(
      <Reveal>
        <p>Bye</p>
      </Reveal>,
    );
    const root = revealRoot(container);
    const observer = observers.find((o) => o.elements.includes(root))!;
    expect(observer).toBeDefined();
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("is revealed immediately when prefers-reduced-motion is reduce", () => {
    mockMatchMedia(true);
    const { container } = render(
      <Reveal>
        <p>Calm</p>
      </Reveal>,
    );
    expect(revealRoot(container)).toHaveAttribute("data-revealed", "true");
  });

  it("is revealed immediately when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(
      <Reveal>
        <p>Old browser</p>
      </Reveal>,
    );
    expect(revealRoot(container)).toHaveAttribute("data-revealed", "true");
    expect(screen.getByText("Old browser")).toBeInTheDocument();
  });
});
