# Task 2 brief: Ask Shef, outside reels and cookbook

Source: Shefali's plan doc ("ShefMeetsChef app plan"). Task 1 (merged) built the schema for all of
v1, including `folders`, `saves`, `usage` and outside recipes (`recipes.source = 'outside'`,
`owner_id`). Read `CLAUDE.md`, `docs/plans/task-1.md` (including "As built") and the code first.

Free limits, enforced on the server and stored per user so a paid plan can lift them later:
- Ask Shef: 10 questions a day (per user, reset at midnight NZ time).
- Outside reels: 5 a month (per user, calendar month NZ time).
- Cookbook: 30 saves in total.
Reaching a limit shows a friendly message with the count ("3 of 5 left this month").

## 1. Ask Shef chat (on each recipe page)
- Signed-in users ask cooking questions about the recipe on screen: swaps, diet versions (vegan,
  Jain/no onion-garlic, gluten free), spice level, scaling. Answers are in Shef's voice: warm,
  casual, home-cook, NZ-Indian, short, practical; sign-offs like "Happy cooking!".
- Gemini (`gemini-2.5-flash`, REST, server-only key) with the recipe as context. Ask Shef only
  answers cooking questions about food; off-topic or unsafe requests get a polite redirect.
  Max question length 500 chars. The recipe text is passed as delimited data, never instructions.
- "Update the recipe on screen": when the answer changes the recipe (e.g. "make it vegan"),
  Gemini returns an optional structured modified recipe (ingredients, steps, diet tags), which the
  page shows as a "Shef's version" toggle. Validated with zod. Not saved (Ask Shef replies are not
  stored); saving as a remix comes in task 3, so leave a clear seam.
- Allergy disclaimer under every answer.
- Counter "7 of 10 questions left today". Usage counted atomically on the server before calling
  Gemini (a security definer function `consume_usage(kind, limit)` that inserts/increments the
  `usage` row for the current period and returns the remaining count, or raises when over the
  limit). Per-IP soft cap too is nice-to-have, not required.
- Anonymous visitors see a "Sign in to ask Shef" prompt.
- The `usage` table may need its `usage_kind` enum extended (check the migration: current values
  are ask/remix) to add `outside_reel`. Migrations are append-only now (task 1 is deployed):
  add new migration files, never edit old ones.

## 2. Outside reels (paste-in)
- Signed-in user pastes an Instagram reel/post link plus the caption text (Instagram does not
  let us read other accounts). Validate the URL with the existing embed allow-list.
- Gemini turns the caption into a recipe card (reuse the task 1 caption parser), saved as
  `source = 'outside'`, `owner_id = user`, `status = 'live'` but visible only to its owner (RLS:
  owner can read their own outside recipes; nobody else can; admin can read all). Not listed in
  public search or the sitemap. Slug unique.
- The card is clearly tagged "From @handle's reel" (parse the handle from the URL if present,
  else "an outside reel"), shows the reel embedded, and still has the "Follow @shefmeetschef"
  button. Store only recipe facts and the link, never the video.
- Counter "3 of 5 left this month". "No recipe found in that caption" does not use up a reel.
- The recipe is saved into the user's cookbook automatically (counts toward 30 saves? No:
  outside reels have their own limit; they appear in the cookbook under "My reels" and do not
  count toward the 30 saves).
- Page: `/add-reel` (form) and the outside recipe uses the same recipe page component at
  `/recipes/[slug]` (owner only; 404 for anyone else).

## 3. Cookbook
- "Save to my cookbook" button on recipe pages (heart). Signed-out users are asked to sign in.
- Folders: create, rename, delete (deleting a folder keeps the saves, unfiled). Default view
  "All saves". Move a save between folders.
- `/cookbook` page: folders as tabs/chips, saved recipe cards, "My reels" section for outside
  recipes, counter "12 of 30 saves used".
- Saves limit enforced in the database (trigger or security definer check) so it cannot be
  bypassed from the browser.
- Header shows "Cookbook" link when signed in.

## Out of scope
Remixes, challenges, moderation (task 3); legal pages, monitoring, backups, PWA (task 4).

## Constraints
CLAUDE.md rules. Free tiers. No secrets in repo. Strict TDD with the four agents. Keep the new
look (fonts, colours, Reveal, 44px targets, AA contrast). Works with no env vars (features that
need Supabase show "not set up yet" like task 1).
