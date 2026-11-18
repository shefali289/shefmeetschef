// Shared class names for the cookbook controls (brand colours, 44px targets, visible focus).
const base =
  "press inline-flex min-h-11 items-center justify-center rounded-full font-bold focus-visible:outline-3 focus-visible:outline-offset-2";

/** Copper primary action. */
export const primaryButton = `${base} bg-copper px-5 py-2 text-white shadow-soft hover:bg-copper-dark focus-visible:outline-cocoa`;

/** Quiet secondary action. */
export const secondaryButton = `${base} border-2 border-cocoa/20 bg-white px-5 py-2 text-cocoa hover:bg-blush-light focus-visible:outline-copper`;

/** Text input or select. */
export const field =
  "block min-h-11 w-full rounded-2xl border-2 border-cocoa/20 bg-white px-4 py-2 text-cocoa focus-visible:border-copper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-copper";

/** Error message, announced. */
export const errorText = "font-semibold text-copper-ink";
