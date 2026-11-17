# Task 1 addendum: fancier UI (Shefali's request)

"Make UI more fancier with fonts and colors and pics where required and animations and smooth ui/ux."
She shared six brand photos (now in `public/brand/*.webp`): a warm, sunlit kitchen, cream walls,
trailing plants with pink flowers, copper pans, wooden spoons, tomatoes and herbs. Her wordmark is
a thin, elegant dark-brown calligraphy script with a small chef hat and a heart; accents are blush
pink brush strokes, a handwritten note style ("for more easy, delicious and fun recipes!"),
"good food good mood" and "cook create eat repeat".

## Brand system (replace the current tokens)
- Colours: cocoa brown text/wordmark (~#4A2C23), cream page (~#FFF7EC), warm peach glow (~#F9E0C2),
  blush pink accent (~#F4B9BA, brush-stroke highlights), herb green (~#5B8A47), copper/burnt orange
  for primary actions (keep ~#B84A1A or a copper that passes AA with white text). All text must pass
  WCAG AA; decorative colours may be lighter.
- Fonts (next/font/google): an elegant calligraphy script for the wordmark and recipe titles (e.g.
  Great Vibes or Allura; titles need a larger size to stay readable), a handwritten accent font for
  small taglines/notes (e.g. Caveat), a warm rounded sans for body/UI (e.g. Nunito).
- Photos: `shef-cooking.webp` (square, at the stove, wordmark on wall) as the home hero image;
  `shef-avatar-cooking.webp` (round crop) as the avatar (header/hero badge, About, later Ask Shef);
  `shef-presenting.webp` and `shef-thinking.webp` for About Shef and empty/404 states;
  `follow-card.webp` in a "Follow along" section linking to Instagram and YouTube.
  Use next/image (sizes, priority on the hero, blur placeholder via a tiny inline data URL or
  placeholder colour) and meaningful alt text ("Shef cooking in her sunlit kitchen").
- Recipe cards without a cover: a warm illustrated placeholder (cream/peach gradient, herb sprig,
  chef hat) instead of the orange block letter.

## Motion and UX
- Gentle entrance animations: fade/slide-up on scroll for sections and cards (staggered), hero
  image soft scale-in, card hover/press lift with shadow, chip and button transitions, animated
  underline on links, smooth scrolling, a subtle brush-stroke highlight under section headings.
- Respect `prefers-reduced-motion` (no movement, instant states). No layout shift (CLS ~0).
- Keep it fast: CSS animations plus one tiny client `Reveal` component using IntersectionObserver;
  no heavy animation library. Page JS should stay small.
- Recipe page: hero with the cover (or illustrated placeholder), sticky "Servings" control on
  mobile is nice-to-have, ingredients and steps as soft cards, step numbers in the script/hand font.
- Header: wordmark with chef hat and heart, translucent cream with blur on scroll.
- Footer: "good food, good mood", Follow buttons for Instagram and YouTube, copyright.

## Must keep
- All existing tests and contracts (accessibility, 44px targets, skip link, one #main, etc.).
- Mobile first. Works with no env vars.
