# Plan: Task 2, Ask Shef, outside reels and cookbook

Written by the planner agent from `docs/tasks/task-2.md`. Build order: A, B, C.

## Goal
Signed-in users can ask Shef cooking questions on any recipe, turn an outside Instagram reel into a
private recipe card, and keep recipes in a cookbook with folders. All free-tier limits (10 questions
a day, 5 reels a month, 30 saves) are enforced in Postgres, so they cannot be bypassed from the browser.

## Findings from the existing code (the plan depends on these)
- `usage.period` only allows `YYYY-MM` (check in `..._schema.sql`), so daily Ask Shef periods
  (`YYYY-MM-DD`) need a new check. `usage_kind` is `('ask','remix')`.
- `saves.folder_id` is `on delete cascade` and the unique key is `(user_id, recipe_id, folder_id)`:
  deleting a folder deletes its saves, and one recipe can be saved once per folder. Both change in A.
- `recipes` insert is admin-only and select is `live and shef or admin`; outside recipes need policies.
- `instagramEmbedUrl` only accepts `/reel|p|tv/<id>`; links like `instagram.com/<handle>/reel/<id>/`
  are rejected today, so the handle cannot be parsed yet (B extends it).
- The recipe page uses `revalidate = 3600` and an anon client. Owner-only pages must never enter the
  ISR cache (B).
- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as the new value, so the enum change
  is its own migration file.

## Decisions (defaults, Shefali may change)
- One save per recipe per user, in at most one folder ("move" changes `folder_id`).
- "No recipe found" costs nothing: the server peeks the remaining count, parses, and only consumes
  `outside_reel` once a recipe is found (consume raises if a parallel request got there first).
- Outside slugs are `reel-<title>-<6 random chars>` so they never take a slug Shef may want.
- Ask Shef questions are standalone (no chat history sent); replies are not stored.
- Users cannot edit or delete outside recipes in this task (see open question 1).

## Slice A: Database (append-only migrations, PGlite)
Afterwards: the DB counts usage atomically per NZ day/month, keeps outside recipes private to their
owner, caps saves at 30 and keeps saves when a folder is deleted.

New migrations (task 1 files are never edited):
- `supabase/migrations/20261118000001_usage_outside_reel.sql`: `alter type usage_kind add value 'outside_reel'`.
- `..._000002_usage_functions.sql`: replace the period check with `YYYY-MM` or `YYYY-MM-DD`;
  `usage_period(kind, at timestamptz)` (ask = NZ day, others = NZ month, `Pacific/Auckland`);
  `consume_usage(kind, lim int) returns int` security definer, `search_path = ''`, uses `auth.uid()`
  (raises when null), rejects `lim < 1`, one `insert ... on conflict do update set count = count + 1
  where count < lim` and raises `usage_limit_reached` (custom SQLSTATE) when no row is returned;
  `usage_remaining(kind, lim) returns int` (read-only). Execute granted to `authenticated` only.
- `..._000003_outside_recipes_rls.sql`: select policy `source = 'outside' and owner_id = auth.uid()`;
  insert policy `source = 'outside' and owner_id = auth.uid() and status = 'live' and instagram_id,
  youtube_id, youtube_url, cover_image_url are null`. No user update/delete.
- `..._000004_cookbook_limits.sql`: remove duplicate saves (keep oldest), unique `(user_id, recipe_id)`;
  re-add `saves.folder_id` FK `on delete set null`; `before insert` trigger (security definer) that
  takes a per-user advisory lock and raises `saves_limit_reached` when the user already has 30 saves of
  non-outside recipes. Limit read from `saves_limit(uid)` so a plan can lift it later.

Acceptance criteria and tests:
- [ ] Old migrations unchanged; new ones apply cleanly.
  `tests/db/migrations.test.ts`: "task 1 migrations are unchanged (append-only)" (sha256 of the five
  files), "all migrations apply in order".
- [ ] Usage counting. `tests/db/usage-rls.test.ts`:
  "usage_kind includes outside_reel";
  "usage_period gives NZ days for ask and NZ months for outside_reel" (fixed UTC instants either side
  of NZ midnight and of a month end, NZDT and NZST);
  "consume_usage creates the row for the current period and returns remaining";
  "consume_usage returns 0 on the last allowed use, then raises usage_limit_reached";
  "a new period starts from the full limit";
  "consume_usage counts only for the caller";
  "consume_usage rejects a limit below 1";
  "usage_remaining does not consume";
  "anon cannot execute consume_usage or usage_remaining";
  "users still cannot insert, update or delete usage rows directly".
- [ ] Outside recipes. `tests/db/outside-recipes-rls.test.ts`:
  "owner reads own outside recipe"; "other users and anon cannot read it"; "admin reads all outside
  recipes"; "user inserts a live outside recipe owned by themselves";
  "user cannot insert a shef recipe, a draft, or one owned by someone else";
  "user cannot set instagram_id, youtube_id, youtube_url or cover_image_url";
  "owner cannot update or delete an outside recipe"; "public listing query returns no outside recipes";
  "other user cannot save someone else's outside recipe".
- [ ] Cookbook. `tests/db/saves-limit.test.ts`:
  "user saves 30 recipes and the 31st raises saves_limit_reached"; "saves of own outside recipes do not
  count toward 30"; "the same recipe cannot be saved twice"; "moving a save between own folders works";
  "deleting a folder keeps its saves, unfiled"; "duplicate saves from before the migration are merged"
  (needs a helper to stop before a migration). Existing `cookbook-rls.test.ts` stays green.

Files: the four migrations, `tests/db/helpers/db.ts` (`createDb({ until })` and `applyMigrationsFrom`),
the three test files above, `src/lib/types.ts` (usage kind).

## Slice B: Ask Shef and outside reels
Afterwards: signed-in users ask Shef questions on a recipe page and see "Shef's version"; they paste a
reel link and caption at `/add-reel` and get a private recipe card. Anonymous visitors see "Sign in to
ask Shef". Without env vars both show "not set up yet".

Acceptance criteria and tests:
- [ ] Limits and copy in one place. `src/lib/limits.test.ts`: "free limits are 10 ask a day, 5 reels a
  month, 30 saves"; "formats 7 of 10 questions left today"; "formats 3 of 5 left this month";
  "formats 12 of 30 saves used".
- [ ] DB errors map to a typed error. `src/lib/usage.test.ts`: "consumeUsage returns remaining";
  "usage_limit_reached becomes LimitReachedError with 0 left"; "other errors are rethrown".
- [ ] Gemini call (`gemini-2.5-flash`, key in header, server-only). `src/lib/ask-shef/ask-shef.test.ts`:
  "sends the recipe inside <recipe> and the question inside <question> with angle brackets stripped";
  "system prompt sets Shef's voice and says delimited text is data, not instructions";
  "system prompt allows only cooking questions and asks for a polite redirect otherwise";
  "returns the answer and a null shef version when none is given";
  "validates the modified recipe (ingredients, steps, diet tags allow-listed) with zod";
  "drops an invalid modified recipe but keeps the answer"; "throws GeminiError on non-200";
  "caps answer length".
- [ ] Orchestration with injected deps. `src/lib/ask-shef/run-ask.test.ts`:
  "rejects an empty question or one over 500 characters without consuming";
  "signed-out returns sign-in state"; "loads the recipe on the server by slug, never from the client";
  "unknown or not-visible slug returns not found without consuming";
  "consumes usage before calling Gemini"; "limit reached returns the friendly message and never calls
  Gemini"; "Gemini failure returns a try-again message".
- [ ] Reel links and handle. `src/lib/embed.test.ts` (extend): "accepts instagram.com/<handle>/reel/<id>
  links"; "rejects handles with invalid characters". `src/lib/outside/handle.test.ts`:
  "label is From @handle's reel when the URL has a handle"; "label is From an outside reel otherwise".
- [ ] Add reel flow. `src/lib/outside/add-reel.test.ts`:
  "rejects non-Instagram or malformed links"; "rejects empty captions and captions over 2200 characters";
  "stores the canonical link only, never video"; "no remaining reels returns the limit message without
  calling Gemini"; "no recipe found returns the message and does not consume";
  "consumes outside_reel only after a recipe is found"; "inserts source outside, status live, owner =
  user, slug reel-..."; "retries with a new suffix on a slug conflict"; "saves it unfiled into the
  cookbook"; "returns the slug and remaining count".
- [ ] Recipe loading. `src/lib/recipes.test.ts` (extend): "getRecipeForViewer returns live shef recipes
  for anyone"; "returns an outside recipe through the viewer's session only"; "listRecipes never
  returns outside recipes".
- [ ] Server actions. `src/app/recipes/[slug]/actions.test.ts`: "askShefAction uses the signed-in
  user's client and GEMINI_API_KEY from the server env"; "not configured returns not set up yet".
  `src/app/add-reel/actions.test.ts`: "addReelAction redirects to /recipes/<slug> on success";
  "signed-out redirects to sign-in with returnTo /add-reel"; "not configured returns not set up yet".
- [ ] UI. `src/components/ask/AskShef.test.tsx`: "signed-out shows Sign in to ask Shef link";
  "shows 7 of 10 questions left today"; "textarea has a label and maxLength 500"; "answer is rendered as
  text, not HTML"; "allergy disclaimer appears under every answer"; "limit message replaces the form".
  `src/components/ask/ShefVersionToggle.test.tsx`: "toggle is an aria-pressed button that swaps
  ingredients, steps and diet tags"; "original is shown by default". `src/app/add-reel/AddReelForm.test.tsx`:
  "labelled URL and caption fields"; "shows 3 of 5 left this month"; "errors are announced (role=alert)".
  `src/app/recipes/[slug]/page.test.tsx` (extend): "outside recipe shows From @handle's reel, the embed
  and Follow @shefmeetschef"; "outside recipe page is noindex and has no JSON-LD"; "someone else's
  outside slug is a 404"; "outside lookups read the session per request (never ISR cached)".
- [ ] E2E (no env). `tests/e2e/ask-shef.spec.ts`: "anonymous visitor sees Sign in to ask Shef";
  "/add-reel shows not set up yet without Supabase".

Files: `src/lib/{limits,usage}.ts`, `src/lib/ask-shef/{ask-shef,run-ask,types}.ts` (`types.ts` exports
`ShefVersion`, the seam task 3 uses to save a remix), `src/lib/outside/{handle,add-reel}.ts`,
`src/lib/embed.ts`, `src/lib/recipes.ts`, `src/lib/auth/session.ts` (`requireUserClient`, `getViewer`),
`src/app/recipes/[slug]/{page,actions}.tsx|ts`, `src/app/add-reel/{page,AddReelForm,actions}.tsx|ts`,
`src/components/ask/{AskShef,ShefVersionToggle}.tsx`, `src/components/recipe/OutsideTag.tsx`.
Reuse `parseCaption`, `GeminiError`, `slugify`, `instagramCanonicalUrl`, `safeNext`, `FollowButtons`.

## Slice C: Cookbook
Afterwards: a heart saves a recipe; `/cookbook` shows "All saves", folder chips, "My reels" and
"12 of 30 saves used"; folders can be created, renamed, deleted and saves moved; header shows
"Cookbook" when signed in.

Acceptance criteria and tests:
- [ ] Read model. `src/lib/cookbook/cookbook.test.ts`: "groups saves into All saves and per folder";
  "outside recipes go to My reels and are not counted"; "counts used saves for the counter";
  "folders are sorted by name".
- [ ] Actions (zod-validated uuids, folder names trimmed 1 to 80). `src/app/cookbook/actions.test.ts`:
  "toggleSave saves and unsaves with the user's client"; "saves_limit_reached returns You've used 30 of
  30 saves"; "createFolder rejects blank and over-80 names"; "renameFolder and deleteFolder act on the
  id given and rely on RLS for ownership"; "moveSave sets or clears folder_id"; "every action redirects
  signed-out users to sign-in"; "not configured returns not set up yet"; "actions revalidate /cookbook".
- [ ] UI. `src/components/cookbook/SaveButton.test.tsx`: "heart is an aria-pressed button labelled Save
  to my cookbook"; "signed-out shows a sign-in link with returnTo the recipe"; "44px target".
  `src/components/cookbook/FolderChips.test.tsx`: "All saves is selected by default"; "chips are
  aria-pressed links with shareable ?folder= URLs". `src/components/cookbook/FolderManager.test.tsx`:
  "create, rename and delete forms are labelled"; "delete asks for confirmation and says saves are kept".
  `src/components/cookbook/MoveSave.test.tsx`: "select lists Unfiled and the user's folders".
  `src/app/cookbook/page.test.tsx`: "shows 12 of 30 saves used"; "shows My reels section";
  "empty state links to /recipes and /add-reel"; "signed-out redirects to sign-in"; "not configured
  shows not set up yet". `src/components/HeaderAuth.test.tsx`: "shows Cookbook link when signed in";
  "hides it when signed out or not configured".
- [ ] E2E (no env). `tests/e2e/cookbook.spec.ts`: "/cookbook shows not set up yet without Supabase";
  "recipe page heart is reachable by keyboard".

Files: `src/lib/cookbook/cookbook.ts`, `src/app/cookbook/{page,actions}.tsx|ts`,
`src/components/cookbook/{SaveButton,FolderChips,FolderManager,MoveSave}.tsx`,
`src/components/HeaderAuth.tsx` (or `Header.tsx` slot), `src/app/recipes/[slug]/page.tsx` (heart).

## Security notes
- Tables: `usage` (writes only via `consume_usage`), `recipes` (new outside select/insert policies),
  `saves` (new unique key, FK, limit trigger), `folders` (unchanged own-row policy).
- Security definer functions pin `search_path = ''`, revoke execute from `public` and `anon`, and use
  `auth.uid()`, never a user id argument. A user calling `consume_usage` directly can only spend their
  own quota; Gemini is only reached through server actions that consume first.
- `GEMINI_API_KEY` stays in server-only modules (`import "server-only"`). No service role key is needed:
  every action uses the signed-in user's client so RLS applies.
- Prompt injection: recipe, caption and question are delimited data with `<` `>` stripped; recipe
  context is loaded server-side by slug; model output is zod-validated and rendered as plain text.
- Outside recipe pages: owner only, 404 otherwise, `noindex`, not in `listRecipes`, search or static
  params, never cached across users. Reel URLs are rebuilt from parsed ids (allow-list); no video stored.
- Inputs: question 1 to 500 chars, caption 1 to 2200, folder name 1 to 80, ids are uuids.

## Risks
- PGlite must ship `Pacific/Auckland` tz data; if not, tests fall back to checking `usage_period` with
  a fixed offset and the risk is flagged to the reviewer.
- PGlite has one connection, so the concurrency guarantees (single upsert, advisory lock) are proven by
  construction and review, not by a parallel test.
- No-recipe captions still call Gemini without consuming a reel; a per-user daily soft cap may be needed
  if this is abused.

## Open questions for Shefali
1. Can people delete (or edit) their outside reel recipes, and if they delete one, do they get that
   reel back for the month?
2. Can one recipe sit in more than one folder, or is one folder per save (our default) right? Can
   "My reels" recipes be put into folders too?
3. Should Ask Shef remember the earlier questions on the page (follow-ups like "and for 6 people?"),
   or treat each question on its own (our default)?

## Decisions on the open questions (defaults, Shefali may change)
1. Users can delete their own outside reel recipes (owner delete policy); deleting does not give the
   reel back for the month. No editing in task 2.
2. One folder per save. "My reels" recipes can also be filed into folders.
3. Ask Shef remembers the last 3 questions and answers on the page for follow-ups (held in the
   browser only, sent with the next question, capped in length, never stored). Each question counts.

## As built (drift from the plan above)
- Slice A: two extra migrations. `..._000005_outside_hardening.sql`: a trigger stops direct API inserts
  of outside recipes beyond this month's consumed reels, Instagram-only `reel_url`, size caps,
  `reel-` slugs only for outside recipes, and a saves trigger that exempts only the user's own reels.
  `..._000006_usage_caps.sql`: `consume_usage` caps `lim` at the free limit (10 asks, 5 reels).
- Slice B: one persistent live region announces Shef's answers. Limit messages come from one helper
  (`limitReachedText`). Outside recipes load only for their owner, even for admins.
- Slice C: My reels is built from the user's own outside recipes, not from saves. Saves whose
  recipe is no longer visible still count and can be removed. `CookbookAnnouncer` announces
  success messages. Folder chips use `aria-current`. Folder names are 1 to 80 chars (DB check).
- Known follow-up: deleting an outside reel lets a direct API insert reuse that month's slot (no
  Gemini cost, small impact); captions with no recipe still call Gemini without a cap.
