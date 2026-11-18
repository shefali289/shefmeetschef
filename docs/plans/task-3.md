# Plan: Task 3, community remixes, likes, weekly challenges and moderation

Written by the planner agent from `docs/tasks/task-3.md`. Build order: A, B, C, D. Release only after
D: in A to C new remixes stay `pending`, because nothing can approve them until D lands.

## Goal
Signed-in cooks post a photo-and-"what I changed" remix of any Shef recipe (5 a NZ day), like and report
approved remixes, and enter Shef's weekly challenge just by remixing its base recipe. Every remix is
checked by Gemini or the admin before anyone else sees it, and status, bans, caps, auto-hide and winner
rules are enforced in Postgres so they cannot be bypassed from the browser.

## Findings from the existing code (the plan depends on these)
- `remixes_insert_own` only checks `exists (select 1 from recipes ...)` through the caller's RLS. Drafts
  are hidden from users, but a user's own outside recipe is visible (`recipes_select_own_outside`), so
  today they **can remix their own outside recipe**. A must require `source = 'shef' and status = 'live'`.
- `authenticated` has `update (recipe_id, challenge_id, photo_path, changes)` on `remixes` and the
  `remixes_update_own` policy. The brief says no editing after posting, so A revokes it. Users can
  also insert `challenge_id` themselves today; A revokes that column and C sets it in a trigger.
- `photo_path` and `changes` are nullable, `changes` has no minimum, and nothing checks that the
  photo object exists or is not shared by two remixes.
- `likes_insert_own` checks the remix through the caller's RLS, so today a user can only like their
  **own** remix, whatever its status. Bob liking his own pending remix is what
  `other-tables-rls.test.ts` "likes are own-row only" does now.
- `usage_period` makes every kind but `ask` monthly, and `usage-rls.test.ts` asserts "remix is monthly
  too". `usage_cap('remix')` is `null` (TODO left for task 3).
- `profiles` are own-row (admin reads all), so a public remix cannot show its author's name through a
  plain join; like counts cannot be counted through RLS either (likes are own-row).
- `shef_remix_photos_own` is `for all` on the owner's folder: the owner can overwrite (upsert), rename,
  or delete-and-reupload a photo after it is approved. Policies on `storage.objects` are permissive, so
  narrowing needs **restrictive** policies.
- Private bucket files can only be fetched with a signed URL (an `<img>` cannot send a JWT). Supabase
  only signs an object for a client whose role passes the `select` policy on `storage.objects`.
- Every server path so far uses the user's or admin's session client. No service role key is used yet.
  The AI verdict cannot be applied with the user's own client (they could call the same function with
  "approve"), so D adds one narrow service-role call.
- Netlify synchronous functions take about 6 MB of request body, and binary bodies are base64-encoded,
  so a 5 MB photo posted through a server action can fail. Next server actions also default to 1 MB.
- Policy subqueries on `storage.objects` from a policy on `storage.objects` would recurse; counts must
  go through a security definer helper.
- `BEFORE` row triggers run before RLS `WITH CHECK` and constraints. A failed check rolls back the whole
  statement, including any usage spent inside the trigger.

## Decisions (defaults, Shefali may change)
- **Approved photos: a storage read rule plus server-made signed URLs.** A new `select` policy on
  `remix-photos` lets anon and users read an object only when `remix_photo_is_public(name)` is true
  (an approved remix of a live Shef recipe by a user who is not banned). The server signs the paths with
  the visitor's own client (`createSignedUrls`, 1 hour). Why: the bucket stays private; the "is it
  approved" rule lives once in the database next to the status, so hiding or banning stops new URLs at
  once; no service role key is needed on every page render; listing the bucket as anon shows approved
  paths only. Signing with the service role instead would put the approval check in app code only and
  widen where that key is used. Trade-off: a URL already issued keeps working until it expires (at most
  1 hour).
- **Photos go straight from the browser to Storage**, into `remix-photos/<uid>/<uuid>.<ext>`, with the
  user's session (RLS, bucket 5 MB and type limits). The browser first re-encodes the photo (longest side
  1600 px), which drops EXIF location data and keeps photos small for the 1 GB free tier. The server
  action receives only the path, checks it is the user's, downloads the file and checks its magic bytes.
- **The remix cap is spent by the insert itself.** A `before insert` trigger (security invoker, so it
  only sees what the caller sees) calls `consume_usage('remix', usage_cap('remix'))` after its other
  checks. A failed insert rolls the count back; deleting a remix does not give it back; a user calling
  `consume_usage('remix')` directly only burns their own quota. The app never calls `consume_usage` for
  remixes (no double count); it reads `usage_remaining` for the counter.
- **Status changes only through functions.** `authenticated` loses every `update` privilege on
  `remixes` (admins too). Status moves only through `apply_ai_verdict` (service role only),
  `admin_moderate_remix`, `admin_ban_user` and the 3-reports trigger.
- **Public reads through one security definer function**, `remix_feed(...)`, which returns approved
  remixes only, with the author's first name and a like count, never `user_id`, email or moderation
  columns. The `remixes` table stays own-row or admin.
- **Bans live in their own table** (`bans`), checked by `is_banned()` in restrictive policies on
  `remixes`, `likes`, `remix_reports` and remix photo uploads. Banning hides the user's remixes and
  removes their likes.
- **Challenges:** one at a time (no overlapping dates); a remix is entered if, on the NZ day it is
  posted, it is of the base recipe of the open challenge; the winner must be an approved entry and can
  be picked only after `ends_on` (NZ). Admins can change the pick.
- The AI's `approve` is never trusted when the text contains a link: it becomes `review`.
- Display name: first word of `profiles.name` (max 40 chars), else "A home cook". Photo alt text:
  "<name>'s remix of <recipe title>".

## Slice A: Database, RLS and storage for remixes and likes (PGlite)
Afterwards: the DB accepts remixes only of live Shef recipes, with a real photo in the user's folder,
5 per NZ day, never from banned users, always `pending`, never edited; anyone can read approved remixes
and their photos and nothing else; likes work only on approved remixes.

New migrations (task 1 and 2 files are never edited):
- `supabase/migrations/20261119000001_remix_usage.sql`: `create or replace usage_period` so `ask` and
  `remix` are NZ days, others NZ months; `create or replace usage_cap` adding `remix` = 5.
- `supabase/migrations/20261119000002_bans.sql`: table `bans (user_id uuid pk -> profiles on delete
  cascade, reason text <= 500, banned_by uuid -> profiles on delete set null, created_at)`; RLS on;
  select own row or admin; no insert/update/delete grants for users (D adds admin functions).
  `is_banned()` security definer, `search_path = ''`, `auth.uid()` only, execute to `authenticated` only.
- `supabase/migrations/20261119000003_remixes_rules.sql`:
  - check `remixes_complete` (`photo_path is not null and char_length(btrim(changes)) between 1 and
    2000`) added `not valid` (applies to new and changed rows); unique index on `photo_path`.
  - revoke `update` on `remixes` from `authenticated`; drop `remixes_update_own`; revoke
    `insert (challenge_id)`.
  - replace `remixes_insert_own`: `user_id = auth.uid()` and the recipe is `source = 'shef' and status
    = 'live'`; restrictive insert policy `not is_banned()`.
  - `remixes_before_insert` trigger (security invoker; only for `anon`/`authenticated`, so seeding still
    works): forces `status = 'pending'`, `created_at = now()`, `challenge_id = null`; requires a
    `remix-photos` object named `photo_path` visible to the caller; then spends the `remix` usage.
  - security definer helpers (`search_path = ''`, public execute revoked): `remix_is_public(id)`,
    `remix_photo_is_public(name)`, `remix_photo_in_use(name)`, and
    `remix_feed(p_recipe_id uuid, p_challenge_id uuid, p_sort text 'newest'|'likes', p_limit int,
    p_offset int)` returning `id, recipe_id, recipe_slug, recipe_title, challenge_id, changes,
    photo_path, author_name, like_count, created_at` for approved remixes of live Shef recipes by users
    who are not banned; limit clamped to 1..48. Execute to `anon, authenticated`.
- `supabase/migrations/20261119000004_likes_rules.sql`: replace `likes_insert_own` with `user_id =
  auth.uid() and remix_is_public(remix_id)`; restrictive insert `not is_banned()`. Delete own stays.
- `supabase/migrations/20261119000005_remix_photos_storage.sql` (all on `storage.objects`):
  `shef_remix_photos_public_read` (select, anon and authenticated, `remix_photo_is_public(name)`);
  restrictive update `with check (bucket_id <> 'remix-photos')` (no overwrite or move, so an approved
  photo cannot be swapped); restrictive delete refusing a `remix-photos` object still used by a remix;
  restrictive insert refusing banned users and a 21st upload in 24 hours
  (`remix_photo_uploads_recent()` definer helper). Other buckets are untouched.

Existing tests changed on purpose (behaviour change, the tester flags each to the reviewer):
`usage-rls.test.ts` "usage_period gives NZ days ..." (remix is now daily); `other-tables-rls.test.ts`
"likes are own-row only" (seed Bob's remix as `approved`); `remixes-rls.test.ts` "user inserts own
remix with default user_id" (upload the photo object first).

Acceptance criteria and tests:
- [ ] Migrations are append-only and apply. `tests/db/migrations.test.ts`: "task 2 migrations are
  unchanged (append-only)" (sha256 of the six 20261118 files); "task 3 migrations apply in order after
  20261118000006"; "enables RLS on every public table" (extend `TABLES` with `bans`).
- [ ] Daily remix cap. `tests/db/usage-rls.test.ts`: "usage_period gives NZ days for ask and remix and NZ
  months for outside_reel"; "usage_cap is 5 for remix"; "consume_usage caps remix at 5 whatever lim is
  passed".
- [ ] Bans. `tests/db/bans-rls.test.ts`: "banned user reads their own ban row"; "other users and anon
  cannot read bans"; "admin reads all bans"; "users and admins cannot insert, update or delete bans
  directly"; "is_banned is true only for the banned caller"; "anon cannot execute is_banned".
- [ ] Posting rules. `tests/db/remixes-rls.test.ts` (extend): "user posts a remix of a live Shef recipe
  and it starts pending"; "status cannot be sent by the client and the trigger forces pending";
  "challenge_id cannot be set by the client"; "remix of a draft or an outside recipe, even the user's
  own, is refused"; "photo must exist in the caller's remix-photos folder"; "the same photo cannot be
  used by two remixes"; "photo is required and changes must be 1 to 2000 characters"; "users cannot
  update any remix column, even their own"; "admin cannot update status directly"; "owner deletes own
  remix, other user cannot"; "banned user cannot post a remix"; "the sixth remix in an NZ day raises
  usage_limit_reached and nothing is inserted"; "a refused insert does not spend a remix"; "deleting a
  remix does not give it back"; "the cap is per user".
- [ ] Public reads. `tests/db/remix-feed.test.ts`: "anon and users see approved remixes through
  remix_feed"; "pending and hidden remixes are not in the feed, even for their owner"; "remixes by
  banned users are not in the feed"; "remixes of a recipe that is no longer live are not in the feed";
  "feed filters by recipe and by challenge"; "feed is newest first, or by like count when sorted by
  likes"; "feed gives the first name only and never user_id or email"; "feed limit is clamped to 48";
  "anon still cannot select remixes rows directly"; "owner still reads own pending and hidden remixes";
  "admin reads every remix".
- [ ] Likes. `tests/db/likes-rls.test.ts`: "user likes an approved remix once and a second like is a
  duplicate"; "user can like their own approved remix"; "liking a pending or hidden remix is refused";
  "banned user cannot like"; "anon cannot like"; "user removes only their own like"; "like_count counts
  each user once".
- [ ] Photos. `tests/db/storage-rls.test.ts` (extend): "anon and other users can read an approved remix
  photo"; "pending, hidden, banned-author and unused remix photos stay private"; "anon listing of
  remix-photos returns approved photos only"; "owner cannot overwrite or move a remix photo"; "a photo
  used by a remix cannot be deleted until the remix is deleted"; "banned user cannot upload remix
  photos"; "the 21st upload within 24 hours is refused"; existing recipe-images and drafts tests stay
  green.

Files: the five migrations, `tests/db/helpers/db.ts` (`seedRemix({ status })`, `uploadObject`,
`banUser` helpers), the test files above, `src/lib/types.ts` (remix and like row types).

## Slice B: Posting remixes, the remix gallery and likes
Afterwards: "Remix this" on every Shef recipe page opens `/recipes/[slug]/remix` (signed-out visitors go
to sign-in and back); users upload a photo and say what they changed, see "3 of 5 remixes left today",
and get "Thanks! Waiting for a quick check". Ask Shef's "Shef's version" can be posted as a remix. The
recipe page shows approved remixes newest first with likes and a link to `/remixes`; owners see their
own remixes with status and can delete them. Without env vars these show "Remixes are not set up yet".

Acceptance criteria and tests:
- [ ] Limits and copy. `src/lib/limits.test.ts` (extend): "free limit is 5 remixes a day"; "formats 3 of
  5 remixes left today"; "limitReachedText for remix says come back tomorrow". `src/lib/usage.test.ts`
  (extend): "remix limit maps to LimitReachedError".
- [ ] Photo checks (client-safe). `src/lib/remix/photo.test.ts`: "accepts JPEG, PNG and WebP up to 5 MB";
  "rejects other types and files over 5 MB with a friendly message"; "sniffImageType reads JPEG, PNG and
  WebP magic bytes and rejects GIF, SVG and HTML renamed .jpg"; "photoPathFor builds <uid>/<uuid>.<ext>";
  "isOwnPhotoPath accepts only the user's <uuid>.(jpg|png|webp)".
  `src/lib/remix/prepare-photo.test.ts` (injected decode/encode): "scales the longest side to 1600 px
  keeping the aspect ratio"; "always re-encodes so metadata is dropped"; "keeps a valid original when the
  browser cannot decode it".
- [ ] Text. `src/lib/remix/changes.test.ts`: "trims and accepts 1 to 2000 characters";
  "shefVersionToChanges lists the changed ingredients and steps and caps at 2000 characters".
- [ ] Orchestration with injected deps. `src/lib/remix/post-remix.test.ts`: "signed-out returns
  sign-in state"; "rejects empty or over-2000 changes before touching storage"; "rejects a photo path
  outside the user's folder"; "loads the recipe by slug on the server, and outside or unknown slugs are
  not found"; "downloads the photo and rejects and removes a file whose bytes are not JPEG, PNG or WebP";
  "inserts only recipe_id, photo_path and changes"; "limit reached removes the photo and returns the
  0 of 5 message"; "banned returns the can't-post message and removes the photo"; "other insert errors
  remove the photo and say try again"; "returns pending with Waiting for a quick check and the
  remaining count".
- [ ] Reading. `src/lib/remix/photos.test.ts`: "signs remix photo paths for 1 hour with the given
  client"; "a path that cannot be signed becomes null and shows a placeholder".
  `src/lib/remix/feed.test.ts`: "loadRemixFeed calls remix_feed with validated filters and page";
  "maps rows to cards with signed URLs and the A home cook fallback"; "loadOwnRemixes reads the
  viewer's remixes for a recipe through their session"; "statusLabel gives Live, Waiting for a quick
  check and Hidden".
- [ ] Server actions. `src/app/recipes/[slug]/remix/actions.test.ts`: "postRemixAction uses the
  signed-in user's client"; "signed-out redirects to sign-in with next /recipes/<slug>/remix"; "not
  configured returns not set up yet"; "revalidates the recipe page and /remixes".
  `src/app/remixes/actions.test.ts`: "toggleLike likes and unlikes with the user's client"; "a
  duplicate like counts as liked"; "a refused like returns a friendly error"; "remix_id must be a
  uuid"; "signed-out redirects to sign-in"; "deleteRemix deletes the row, then the photo"; "deleteRemix
  says not found when RLS deleted nothing".
- [ ] UI. `src/components/remix/RemixThisButton.test.tsx`: "signed-in links to /recipes/<slug>/remix";
  "signed-out links to sign-in with next"; "not configured says Remixes are not set up yet"; "44px
  target". `src/components/remix/RemixForm.test.tsx`: "photo input is labelled and accepts JPEG, PNG and
  WebP"; "what I changed has a label and maxLength 2000"; "shows 3 of 5 remixes left today"; "limit
  message replaces the form"; "prefills once from Shef's version and clears it"; "uploads to the user's
  folder before calling the action"; "errors are announced (role=alert)".
  `src/components/remix/RemixCard.test.tsx`: "photo alt is <name>'s remix of <recipe>"; "what they
  changed is plain text, not HTML"; "shows the like count"; "owner view shows the status text and a
  delete button that asks to confirm". `src/components/remix/LikeButton.test.tsx`: "aria-pressed heart
  labelled with the author and count"; "signed-out shows a sign-in link"; "count updates at once";
  "44px target". `src/components/ask/AskShef.test.tsx` (extend): "Shef's version offers Post this as my
  remix when signed in, stores the prefill and links to the remix page".
  `src/app/recipes/[slug]/page.test.tsx` (extend): "Shef recipe shows Remix this and approved remixes
  newest first with a link to /remixes?recipe=<slug>"; "outside recipe has no Remix this or remixes";
  "owner sees own pending remix with Waiting for a quick check"; "not configured shows not set up yet".
  `src/app/recipes/[slug]/remix/page.test.tsx`: "signed-out redirects to sign-in"; "outside or unknown
  slug is a 404"; "banned user sees the can't-post message"; "page is noindex".
  `src/app/remixes/page.test.tsx`: "lists approved remixes newest first"; "filters by ?recipe= and
  ?challenge=, ignoring invalid values"; "pages 24 at a time"; "not configured shows not set up yet".
- [ ] Guards. `src/lib/env.test.ts` (extend): server modules `post-remix.ts`, `photos.ts` import
  `server-only` and no client component imports them.
- [ ] E2E (no env). `tests/e2e/remixes.spec.ts`: "Remix this is reachable by keyboard and says not set
  up yet without Supabase"; "/remixes shows not set up yet without Supabase".

Files: `src/lib/{limits,usage}.ts`, `src/lib/remix/{photo,prepare-photo,changes,post-remix,photos,feed,
types}.ts`, `src/app/recipes/[slug]/remix/{page,actions}.tsx|ts`, `src/app/remixes/{page,actions}.tsx|ts`,
`src/components/remix/{RemixThisButton,RemixForm,RemixCard,RemixList,LikeButton}.tsx`,
`src/components/ask/AskShef.tsx`, `src/app/recipes/[slug]/page.tsx`, `src/lib/env.test.ts`. Reuse
`ShefVersion`, `getViewer`, `requireUserClient`, `getRecipeBySlug`, `safeNext`, `Reveal`,
`src/lib/supabase/client.ts`.

## Slice C: Weekly challenges
Afterwards: the admin creates a challenge at `/admin/challenges` (live Shef base recipe, title,
description, Monday to Sunday NZ by default). The open challenge shows as a banner on the home page and
its base recipe page ("This week's remix challenge", #ShefMeetsChefRemix, "3 days left"). Remixes of the
base recipe posted while it is open are entered. `/challenges/[id]` lists approved entries (newest first;
by likes for the admin, who picks a winner once it ends); the winner gets a "Winner" badge and the page
says "Featured in Shef's reel". `/challenges` lists current and past challenges.

New migration: `supabase/migrations/20261119000006_challenges_rules.sql`: `nz_today()`; `description`
<= 2000 (`not valid`); `challenges_validate` trigger (security definer, `search_path = ''`, advisory
lock): base recipe must be a live Shef recipe, no overlapping dates, `winner_remix_id` may be set only
after `ends_on` (NZ) and only to an approved remix whose `challenge_id` is this challenge;
`create or replace` the remix insert trigger function so it sets `challenge_id` to the open challenge
whose base recipe is `recipe_id` on `nz_today()`.

Acceptance criteria and tests:
- [ ] DB. `tests/db/challenges-rls.test.ts`: "anon, users and banned users read challenges; only admin
  creates, edits and deletes"; "base recipe must be a live Shef recipe"; "overlapping challenges are
  refused and back-to-back weeks are fine"; "ends_on before starts_on is refused"; "a remix of the base
  recipe while the challenge is open is entered automatically"; "a remix of another recipe, or posted
  before or after the NZ dates, is not entered"; "the client cannot choose the challenge"; "only the
  admin picks a winner, only after the end, only from approved entries of that challenge"; "users and
  banned users cannot set winner_remix_id"; "deleting the winning remix clears the winner"; "nz_today
  follows Pacific/Auckland".
- [ ] Dates. `src/lib/challenges/dates.test.ts`: "nzToday uses Pacific/Auckland"; "defaultChallengeWeek
  is Monday to Sunday NZ (today if Monday, else next Monday)"; "daysLeftText gives 3 days left, 1 day
  left and Last day today"; "isOpen and hasEnded use NZ dates".
- [ ] Read model. `src/lib/challenges/challenges.test.ts`: "getCurrentChallenge returns the open
  challenge with its base recipe slug, or null"; "listChallenges gives current then past, newest first";
  "getChallenge gives entries newest first for visitors and by likes for the admin"; "the winner is
  flagged".
- [ ] Admin actions. `src/app/admin/challenges/actions.test.ts`: "createChallenge checks admin on the
  server"; "validates title 1 to 200, description up to 2000, end on or after start, base recipe uuid";
  "overlap and non-live recipe errors become friendly messages"; "pickWinner checks admin and maps not
  ended and not an entry errors"; "revalidates /, /challenges, the challenge page and the base recipe".
- [ ] UI. `src/components/challenges/ChallengeBanner.test.tsx`: "shows This week's remix challenge, the
  title, #ShefMeetsChefRemix and 3 days left"; "links to the challenge page"; "on the base recipe it
  links to Remix this". `src/app/admin/challenges/ChallengeForm.test.tsx`: "fields are labelled"; "base
  recipe select lists live Shef recipes only"; "dates default to Monday to Sunday NZ".
  `src/app/challenges/page.test.tsx`: "shows the current challenge then past ones with their winner".
  `src/app/challenges/[id]/page.test.tsx`: "entries newest first for visitors"; "admin sees entries by
  likes and Pick as winner after the end"; "winner badge and Featured in Shef's reel"; "unknown id is a
  404"; "not configured shows not set up yet". `src/app/page.test.tsx`: "home shows the banner while a
  challenge is open and nothing otherwise or without Supabase". `src/app/recipes/[slug]/page.test.tsx`
  (extend): "base recipe page shows the challenge banner". `src/components/remix/RemixForm.test.tsx`
  (extend): "on the base recipe the form says this remix enters the challenge".
- [ ] E2E (no env). `tests/e2e/challenges.spec.ts`: "/challenges shows not set up yet without Supabase";
  "home has no challenge banner without Supabase".

Files: the migration, `src/lib/challenges/{dates,challenges}.ts`,
`src/app/admin/challenges/{page,actions,ChallengeForm}.tsx|ts`, `src/app/challenges/page.tsx`,
`src/app/challenges/[id]/{page,actions}.tsx|ts` (pick winner, admin-checked),
`src/components/challenges/{ChallengeBanner,WinnerBadge}.tsx`, `src/app/page.tsx`,
`src/app/recipes/[slug]/page.tsx`, `src/app/admin/page.tsx` (nav link).

## Slice D: Moderation, reports, bans and the admin queue
Afterwards: each new remix is checked by Gemini: `approve` makes it live, `review` leaves it pending for
the admin, `reject` hides it and tells the user kindly why; without Gemini or the service key it stays
pending. Signed-in users report an approved remix once (optional reason); three reports from different
users hide it. `/admin/remixes` lists pending and reported remixes with photo, text, AI reason and
reports, with approve, hide and ban. Banned users cannot post, like or report, and their remixes are
hidden.

New migrations:
- `supabase/migrations/20261119000007_remix_reports.sql`: `remixes` columns `ai_verdict`
  (`approve|review|reject`), `ai_reason` (<= 300), `ai_checked_at`, `hidden_by`
  (`ai|reports|admin|ban`), `reports_cleared_at`, `moderated_at` (no user grants);
  table `remix_reports (remix_id -> remixes on delete cascade, user_id default auth.uid() -> profiles,
  reason text <= 300, created_at, primary key (remix_id, user_id))`, RLS on, insert own on a public remix
  that is not their own, restrictive `not is_banned()`, select own or admin, no update or delete; an
  `after insert` security definer trigger that locks the remix and hides it (`hidden_by = 'reports'`)
  when 3 distinct users reported it since `reports_cleared_at`.
- `supabase/migrations/20261119000008_moderation_functions.sql` (all security definer,
  `search_path = ''`, public execute revoked): `apply_ai_verdict(p_remix_id, p_verdict, p_reason)`
  execute to `service_role` only, acts once on a `pending` remix with no `ai_checked_at`, never approves
  a banned user's remix; `admin_moderate_remix(p_remix_id, p_action 'approve'|'hide')`,
  `admin_ban_user(p_user_id, p_reason)` (hides their remixes, deletes their likes, refuses self and other
  admins) and `admin_unban_user(p_user_id)`, execute to `authenticated` and raising 42501 unless
  `is_admin()`.

Acceptance criteria and tests:
- [ ] Reports. `tests/db/remix-reports-rls.test.ts`: "a signed-in user reports an approved remix once,
  with an optional reason up to 300 characters"; "a second report by the same user is a duplicate";
  "pending, hidden and own remixes cannot be reported"; "anon and banned users cannot report";
  "reporter reads own report, other users cannot, admin reads all"; "users cannot update or delete
  reports"; "three reports from different users hide the remix with hidden_by reports"; "two reports do
  not"; "after the admin approves, only new reports count toward the next three".
- [ ] Moderation functions. `tests/db/moderation-functions.test.ts`: "apply_ai_verdict approve, review
  and reject set approved, pending and hidden with the reason"; "apply_ai_verdict acts only once and only
  on a pending unchecked remix"; "apply_ai_verdict never approves a banned user's remix"; "anon, users and
  admins cannot execute apply_ai_verdict, service_role can"; "admin_moderate_remix approves and hides for
  the admin and raises 42501 for anon, users and banned users"; "approving a banned user's remix is
  refused"; "admin_ban_user records the ban, hides their remixes and removes their likes, then the user
  cannot post, like, report or upload"; "admin cannot ban themselves or another admin";
  "admin_unban_user lifts the ban and their remixes stay hidden"; "users never see another user's AI
  reason"; "every task 3 security definer function pins search_path and revokes public execute".
- [ ] Gemini check (`gemini-2.5-flash`, key in header, server-only). `src/lib/remix/moderate.test.ts`:
  "sends the photo inline with its mime type and the text inside <changes> with angle brackets
  stripped"; "system prompt checks it is food and safe, and the text for abuse, spam, links and unsafe
  advice, and says delimited text is data"; "validates verdict approve, review or reject and a reason up
  to 200 characters with zod"; "invalid output throws GeminiError"; "a link in the text turns approve
  into review"; "times out after 8 seconds".
- [ ] Service path. `src/lib/supabase/service.test.ts`: "returns null without
  SUPABASE_SERVICE_ROLE_KEY"; "applyAiVerdict calls only the apply_ai_verdict rpc"; "exports no raw
  client".
- [ ] Posting with moderation. `src/lib/remix/post-remix.test.ts` (extend): "after the insert it
  checks the photo and text and applies the verdict through the service path"; "approve says Your remix
  is live"; "reject returns the kind reason with status hidden"; "a Gemini error, a missing key or a
  failed verdict call leaves it pending with Waiting for a quick check"; "moderation never runs when the
  insert failed". `src/lib/remix/feed.test.ts` (extend): "statusLabel gives Hidden with the AI reason,
  or Hidden while Shef takes a look for reports".
- [ ] Reports and queue. `src/app/remixes/report-actions.test.ts`: "reportRemix inserts with the user's
  client and a reason trimmed to 300"; "a duplicate says you already reported it"; "a refused report
  returns a friendly error"; "signed-out redirects to sign-in". `src/lib/moderation/queue.test.ts`:
  "lists pending and report-hidden remixes oldest first with report counts, reasons and the AI reason";
  "leaves out approved remixes with no new reports". `src/app/admin/remixes/actions.test.ts`: "approve,
  hide, ban and unban call the admin functions with the admin's client"; "non-admins are refused on the
  server"; "ids are validated"; "ban needs the confirm field"; "revalidates /admin/remixes, /remixes and
  the recipe page".
- [ ] UI. `src/components/remix/ReportButton.test.tsx`: "Report opens a labelled optional reason and a
  confirm button"; "after reporting it says Reported, thanks"; "not shown on own remixes and shows a
  sign-in link when signed out"; "44px target". `src/app/admin/remixes/page.test.tsx`: "shows each photo
  with alt text, what they changed, the AI reason, report count and reasons"; "approve, hide and ban are
  labelled per remix"; "empty state says Nothing to check"; "photos are signed with the admin's session".
- [ ] Guards and E2E. `src/lib/env.test.ts` (extend): `moderate.ts` and `service.ts` are server-only and
  never imported by a client component; `.env.example` lists an empty `SUPABASE_SERVICE_ROLE_KEY`.
  `tests/e2e/admin.spec.ts` (extend): "/admin/remixes and /admin/challenges show the not set up notice
  without Supabase".

Files: the two migrations, `src/lib/remix/moderate.ts`, `src/lib/supabase/service.ts`,
`src/lib/remix/post-remix.ts`, `src/lib/moderation/queue.ts`, `src/app/remixes/report-actions.ts`,
`src/components/remix/ReportButton.tsx`, `src/components/remix/RemixCard.tsx`,
`src/app/admin/remixes/{page,actions}.tsx|ts`, `src/app/admin/page.tsx` (nav link), `.env.example`.
Reuse `GeminiError`, `GEMINI_DEFAULT_MODEL`, `requireAdminClient`, `adminGate`.

## Security notes
- Tables: `remixes` (no user updates; insert rules, trigger and cap; moderation columns), `likes`
  (approved only, not banned), `challenges` (validation trigger; existing admin policies), `usage`
  (remix daily, cap 5, written only by `consume_usage`), new `bans` and `remix_reports` (RLS on, no
  user update or delete), `profiles` (names read only inside `remix_feed`, first name only),
  `storage.objects` (`remix-photos` approved read, restrictive no-update, no-delete-in-use, banned and
  upload-rate insert rules).
- Status changes only through `apply_ai_verdict` (service role), `admin_moderate_remix`,
  `admin_ban_user` and the 3-reports trigger. Winner picks only by the admin through RLS plus the
  validation trigger.
- Every security definer function pins `search_path = ''`, revokes execute from `public` (and `anon`
  where not needed) and uses `auth.uid()`, never a user id argument, except the admin functions, which
  check `is_admin()` first.
- Secrets: `GEMINI_API_KEY` and the new `SUPABASE_SERVICE_ROLE_KEY` are read only in `server-only`
  modules (`moderate.ts`, `service.ts`), never `NEXT_PUBLIC_`. The service client is used for one call
  (`apply_ai_verdict`); `service.ts` exports only that function.
- Prompt injection: the text goes in `<changes>` with `<` `>` stripped; the verdict is zod-validated; a
  link never auto-approves; output is never rendered as HTML.
- Inputs: changes 1 to 2000, report reason up to 300, challenge title 1 to 200 and description up to
  2000, ids are uuids, photo paths `<uid>/<uuid>.(jpg|png|webp)`, file bytes sniffed on the server.
- Remix form and admin pages are `noindex`; `remix_feed` never returns `user_id`, email or moderation
  data.

## Risks
- The service role key is new on Netlify. It is limited to one module and one rpc, but it bypasses RLS.
  An alternative is a Supabase Edge Function holding the Gemini key and its built-in service role, at
  the cost of a Deno test setup; flagged for the reviewer.
- Gemini free-tier rate limits and the Netlify function timeout (about 10 s) may leave many remixes
  pending. That fails safe, but the admin queue may grow.
- Signed URLs change on every render, so browsers cannot cache photos. Storage egress on the free tier
  is kept down by 1600 px re-encoding; watch it in task 4.
- A photo URL already issued keeps working for up to 1 hour after a remix is hidden.
- Uploads that never become remixes (closed tab, direct API) use storage. They are capped at 20 per user
  per day; a cleanup job belongs with task 4.
- Photo paths contain the user's uuid, which appears in signed URLs. Low risk, noted.
- EXIF is stripped only by our own browser code; someone uploading through the API keeps their own
  metadata.
- PGlite has no Storage API, so tests prove the `storage.objects` policies; that Supabase signs only
  objects that pass `select` is checked by hand once on the real project.
- Tests that depend on today's NZ date (cap, open challenge, winner after end) must build dates from
  `now()` in Pacific/Auckland, not fixed dates.
- Three existing tests change on purpose (listed in slice A); the reviewer confirms each change follows
  the brief.

## Open questions for Shefali (each with the default we build)
1. What name shows on a public remix? Default: first name from their sign-in profile, or "A home cook".
2. Does a remix that the AI rejects, or that the user deletes, still count toward 5 a day? Default: yes.
3. Can people report their own remix? Default: no. (Liking your own is allowed, as in the brief.)
4. After you approve a reported remix, can three new reports hide it again? Default: yes, counting only
   reports made after your review.
5. Bans: can you unban someone, and what happens to their likes and remixes? Default: you can unban from
   the queue; banning removes their likes and hides their remixes, which stay hidden after an unban.
   Other admins cannot be banned.
6. Can two challenges run at the same time? Default: no, one at a time.
7. A remix posted during the challenge but approved after it ends: is it still an entry? Default: yes,
   entry is decided on the day it is posted.
8. One winner per challenge, and can you change your pick? Default: one winner, changeable.
9. Until the community rules page (task 4), should challenge entries carry a note that they may be
   featured in your reel? Default: yes, a short line on the remix form and challenge page.
10. Should people see the AI's reason when a remix is held for review (not rejected)? Default: no, they
    see "Waiting for a quick check".
11. Photos are resized to 1600 px in the browser before upload (smaller files, location data removed).
    Is that big enough? Default: yes.
12. Should the admin get an alert when the queue has remixes waiting? Default: no alert in task 3, a
    count on the admin page only.

## As built (drift from the plan above)
- Slice A: hardening after review in 000003/000005: invisible-space-only text refused, emails never
  shown as names, `remix_photo_in_use` limited to the caller's folder, at most 5 unused photos per
  user, an advisory lock on upload counts, and a guard that the migration role bypasses RLS.
- Slice B: one persistent status region per remix section; focus moves to the remixes heading after
  delete. The recipe page shows 6 remixes and leaves the viewer's own out of the public list.
- Slice C: `remix_feed` gained `p_remix_id` (drop and recreate in 000006) so the winner is read
  directly. `pickWinner` lives in `src/app/admin/challenges/actions.ts`. The home page uses a
  cookie-free public client and can be up to an hour stale at NZ midnight.
- Slice D: report reason is 300 chars; banned reporters don't count toward the 3; the report
  trigger locks with `for no key update` (avoids a deadlock with the FK check). The moderation
  queue uses two bounded queries and shows an error instead of an empty queue on failure.
  `markOwn` hides Report on your own remixes. Gemini moderation timeout stays 8 s.
- Tests live in extra `*.challenge`, `*.moderation`, `*.own` and `*.report` test files next to the
  originals so parallel work did not clash.
