# Plan: Task 1, foundation and Shef's recipes

Written by the planner agent from `docs/tasks/task-1.md`. Build order: A, B, C, D.

## Decisions (defaults, Shefali may change)
- Captions with no recipe are skipped and listed as "skipped: no recipe" in the import summary.
- Allergens follow the Australia/NZ (FSANZ) list: peanut, tree nuts, milk, egg, fish, crustacea,
  mollusc, soy, sesame, wheat, gluten, lupin.
- Recipe photo defaults to the Instagram/YouTube thumbnail; it can be replaced in the admin form.
- Search matches title, description and ingredients.

## Slice A: Database, RLS and storage (PGlite)
Afterwards: `supabase/migrations` gives the full v1 schema, with RLS proven by tests.

Test-only auth stub `tests/db/helpers/auth-stub.sql` (exists already on real Supabase): roles
`anon`, `authenticated`, `service_role`; `auth.users`; `auth.uid()` reading
`current_setting('request.jwt.claim.sub', true)`; `storage.buckets`, `storage.objects` (RLS on),
`storage.foldername()`. `tests/db/helpers/db.ts`: `createDb()`, `asAnon`, `asUser`, `asAdmin`,
`createUser` — each runs in a transaction with `set local role` and the jwt claim set.

Migrations: `..._schema.sql` (enums, 8 tables, checks, `updated_at` trigger), `..._rls.sql`
(RLS on all, `is_admin()` security definer with pinned search_path, grants, policies),
`..._profile_trigger.sql` (profile on sign-up; guard on is_admin/plan), `..._storage.sql`
(buckets `recipe-images` public, `remix-photos` and `drafts` private, object policies).

Policies: recipes select `(live and shef) or is_admin()`, writes admin only. Profiles own row,
admin reads all, no insert/delete. Folders/saves own rows. Likes/remixes own rows; usage
select-only for users. Challenges anon read, admin write. Storage: recipe-images public read,
admin write; remix-photos owner folder `<uid>/...`; drafts admin only.

Tests: `tests/db/migrations.test.ts`, `recipes-rls.test.ts`, `profiles-rls.test.ts`,
`cookbook-rls.test.ts`, `other-tables-rls.test.ts`, `storage-rls.test.ts`. Plus `src/lib/types.ts`.

## Slice B: Recipe domain and card page
Afterwards: `/recipes/[slug]` shows a sample recipe with a working servings slider, no setup.

Files: `src/lib/{scaling,sample-recipes,recipes,embed,jsonld}.ts`, `src/lib/supabase/config.ts`,
`src/components/recipe/{ServingsScaler,IngredientList,DietTags,AllergenBox,StepList,MediaEmbeds,RecipeActions}.tsx`,
`src/app/recipes/[slug]/page.tsx` with `generateMetadata` and `notFound()`.

Criteria: nice fractions (1.5 → 1 1/2, thirds, eighths), scaling keeps units, null qty untouched,
servings clamped 1..12; sample fallback without env; only live recipes; safe embed URLs from
parsed ids with host allow-list; JSON-LD Recipe with `<` escaped; accessible keyboard slider;
allergen box always says "check labels if you have an allergy"; action buttons only when URLs exist,
external links `rel="noopener noreferrer"`. E2E `tests/e2e/recipe-page.spec.ts`.

## Slice C: Home, branding, search and filters
Afterwards: branded home page; `/recipes` searchable and filterable with shareable URLs.

Files: brand tokens in `globals.css` (`@theme`), fonts in `layout.tsx` (script for titles only),
`src/components/brand/{Wordmark,Hero,AboutShef,Header}.tsx`, `src/components/recipe/{RecipeCard,RecipeGrid}.tsx`,
`src/lib/filters.ts` (zod allow-listed values), `src/components/search/{SearchBar,FilterChips}.tsx`,
`src/app/page.tsx`, `src/app/recipes/page.tsx`.

Criteria: filters parse and round-trip; AND across groups, OR within; case-insensitive text search;
home shows "Hi, I'm Shef", tagline and About copy; chips are `aria-pressed` toggles with 44px
targets. E2E `tests/e2e/search.spec.ts`.

## Slice D: Auth and admin import
Afterwards: Google or magic-link sign-in; admins import posts as drafts, edit and publish.

Files: `src/lib/supabase/{server,client,middleware}.ts`, `src/middleware.ts`, sign-in page and
`auth/callback` route (relative redirects only), `AuthButton`, `src/lib/auth/require-admin.ts`,
`src/lib/import/{gemini-parser,instagram,youtube,slug,run-import}.ts` (all `import "server-only"`
except pure helpers), `src/app/admin/{layout,page,actions}.ts(x)`, `src/app/admin/recipes/[id]/page.tsx`,
`src/components/admin/DraftForm.tsx`.

Criteria: Gemini `gemini-2.5-flash` with JSON schema, key in header, output validated by zod,
caption passed as delimited data; Instagram `/me/media` with paging; YouTube uploads playlist;
import skips existing ids, saves drafts, isolates failures, returns {imported, skipped, failed};
admin checked server-side in layout and every action; no server keys in `NEXT_PUBLIC_`.
E2E `tests/e2e/admin.spec.ts`.

## Risks
- `next/font/google` needs network at build; fall back to `next/font/local` if blocked.
- Instagram tokens expire after 60 days; auto refresh comes with the daily job in a later task.

## As built (drift from the plan above)
- Slice A: a fifth migration `..._import_skips.sql` (admin-only table of posts not to re-import);
  extra tests `tests/db/remixes-rls.test.ts` and `tests/db/import-skips-rls.test.ts`. Buckets have a
  5 MB limit and JPEG/PNG/WebP only. Users cannot set remix status.
- Slice B/C: shared helpers `src/lib/{site,share-image,labels,filters-query,taxonomy}.ts`,
  `SkipLink`, `HerbSprig`, `public/og-default.png` and a placeholder `public/shef-avatar.svg`.
  Script font is used for recipe titles and the wordmark logo. Brand orange is `#B84A1A` for contrast.
- Slice D: `src/lib/auth/{session,safe-redirect,admin-sign-in}.ts`, POST-only sign-out with an
  Origin check, `HeaderAuth`, `src/lib/draft-{limits,form}.ts`, `src/lib/import/copy-cover.ts`
  (covers are copied into `recipe-images` on publish because Instagram thumbnail links expire),
  and the last import summary kept in a small cookie. Each import run parses at most 3 posts;
  no-recipe and invalid captions are remembered in `import_skips`, transient errors are retried.
- Known follow-up: the header reads the session cookie, so pages render per request once
  Supabase is configured (ISR does not apply). Fine for launch traffic; revisit in task 4.
