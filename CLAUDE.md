# ShefMeetsChef — working rules

Recipe website for @shefmeetschef. Next.js 15 (App Router, TypeScript, Tailwind 4), Supabase
(Postgres, Auth, Storage, Edge Functions), Gemini for AI, hosted on Netlify. Everything must
stay on free tiers.

## Agent harness

Work is done by four agents in `.claude/agents/`, always in this order for each slice:

1. **planner** — turns a task into small slices, each with acceptance criteria and the tests
   that prove them. Writes the plan to `docs/plans/<task>.md`. Writes no code.
2. **tester** — writes the failing tests for one slice and shows they fail (red).
3. **implementer** — writes the smallest code that makes those tests pass (green), then
   refactors. Never edits a test to make it pass; if a test is wrong it reports back.
4. **reviewer** — reviews the slice diff for correctness, security (RLS, secrets, input
   validation), accessibility and plan coverage. Blocking findings go back to the implementer.

A slice is done only when `npm run check` passes (lint, types, unit, DB and build).

## Test-driven development

- No production code without a failing test first.
- Unit and component tests: Vitest + Testing Library, next to the code as `*.test.ts(x)`.
- Database and security rules: `tests/db/*.test.ts` run every migration in
  `supabase/migrations` against PGlite (in-memory Postgres) and check RLS as anon, users and admin.
- Browser flows: Playwright in `tests/e2e`.

## Rules

- Secrets never go in the repo. Only `.env.example` with empty values is committed.
  `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Instagram and YouTube keys are server-only and
  must never be imported from a client component or prefixed `NEXT_PUBLIC_`.
- Every table has RLS enabled. Free-tier limits are enforced on the server, not the browser.
- Without Supabase keys the site runs on sample recipes (`src/lib/sample-recipes.ts`) so it can
  be previewed locally with no setup.
- Storage: Supabase Storage. `recipe-images` is public (published recipes only);
  `remix-photos` and `drafts` are private, read through signed URLs. Cloudflare R2 later if
  photos outgrow 1 GB.
- Mobile first. WCAG 2.2 AA: alt text, contrast, keyboard access, 44px tap targets.
- Brand (tokens in `src/app/globals.css`): cocoa brown text `--color-cocoa`, cream page
  `--color-cream`, peach glow `--color-peach`, blush pink brush-stroke accents `--color-blush`
  (decorative only), herb green `--color-herb`, copper primary actions `--color-copper` (old
  `shef-orange`/`shef-cream`/`shef-navy` names are aliases). Fonts: Great Vibes script
  (`font-script`) for recipe titles and the wordmark logo only, Caveat (`font-hand`) for small
  handwritten notes, Nunito (`font-sans`) for everything else. Motion is CSS plus `Reveal`; it
  must respect `prefers-reduced-motion`.

## Commands

- `npm run dev` — local site at http://localhost:3000
- `npm test` — unit, component and DB tests
- `npm run test:e2e` — Playwright browser tests
- `npm run check` — everything CI runs
