# Task 3 brief: community remixes, likes, weekly challenges and moderation

Source: Shefali's plan doc ("ShefMeetsChef app plan"). Tasks 1 and 2 are merged and deployed.
The schema already has `remixes` (recipe_id, user_id, photo_path in `remix-photos/<uid>/...`,
changes, status pending|approved|hidden, challenge_id), `likes` (user_id, remix_id) and
`challenges` (base_recipe_id, title, description, starts_on, ends_on, winner_remix_id), plus the
`remix` usage kind. Read `CLAUDE.md`, `docs/plans/task-1.md` and `docs/plans/task-2.md`
(including "As built") and the code first. Migrations are append-only: add new files only.

## 1. Remixes
- "Remix this" on every public recipe page (Shef recipes; not outside reels). Signed-in users post
  a photo (JPEG/PNG/WebP, max 5 MB, into their own `remix-photos/<uid>/` folder) and "what I
  changed" text (1 to 2000 chars). Signed-out users are asked to sign in.
- Ask Shef's "Shef's version" can be posted as a remix: prefill "what I changed" from the
  modified recipe (the seam left in task 2). The photo stays required.
- New remixes start `pending` and appear publicly only once `approved`. The owner always sees
  their own remix with its status ("Waiting for a quick check", "Hidden").
- Recipe page shows approved remixes (photo, name, what they changed, like count), newest first,
  with a link to `/remixes` (all approved remixes, filter by recipe or challenge).
- Photos stay in the private bucket; approved remix photos are shown through short-lived signed
  URLs made on the server (or an equivalent safe read rule that exposes only approved photos).
- Owners can delete their own remix (and its photo). No editing after posting.
- Free limit: 5 remixes a day per user (NZ day), enforced in the database with the existing
  `consume_usage`/`usage_cap` pattern (add the `remix` cap). Counter "3 of 5 remixes left today".
- Users cannot set `status` (already true) or pick a winner.

## 2. Likes
- Heart on each approved remix: like/unlike, signed-in only, one like per user per remix, count
  shown. You cannot like a pending/hidden remix. Liking your own remix is allowed (default).

## 3. Weekly challenges
- Admin creates a challenge on `/admin/challenges`: base recipe (a live Shef recipe), title,
  description, start and end dates (default: Monday to Sunday NZ time).
- The current challenge shows as a banner on the home page and on its base recipe page
  ("This week's remix challenge"), with hashtag #ShefMeetsChefRemix and a countdown in days.
- Remixes posted from the base recipe while the challenge is open are entered automatically.
- Challenge page `/challenges/[id]`: entries (approved only) sorted by likes for the admin's
  pick, newest first for visitors. Admin picks a winner after it ends; the winner gets a
  "Winner" badge and the page shows "Featured in Shef's reel".
- Past challenges list at `/challenges`.

## 4. Moderation
- AI check before a remix shows: Gemini (`gemini-2.5-flash`, server-only key) checks the photo
  (is it food, is it safe) and the text (no abuse, spam, links or unsafe advice), returning a
  zod-validated verdict `approve | review | reject` with a short reason. `approve` sets the
  remix to `approved`; `review` leaves it `pending` for the admin; `reject` sets `hidden` and
  tells the user kindly why. If Gemini is not set up or fails, the remix stays `pending`.
  Status changes happen only on the server (security definer function or admin-only path).
- Report button on approved remixes (signed-in users, once per remix, optional reason). Three
  reports from different users hide the remix (`hidden`) until the admin looks.
- Admin queue `/admin/remixes`: pending and reported remixes with photo, text, AI reason and
  reports; actions approve, hide, and ban the user. Banned users cannot post remixes, like or
  report (enforced in the database), and their remixes are hidden.

## Out of scope
Legal pages (terms and community rules including consent to feature remixes), monitoring,
backups, PWA, shareable story cards (task 4).

## Constraints
CLAUDE.md rules. Free tiers. No secrets in repo. Strict TDD with the four agents. RLS on every new
table and storage rule, proven in PGlite as anon, users, another user, a banned user and admin.
Keep the look (fonts, colours, Reveal, 44px targets, AA contrast). Works with no env vars
(features that need Supabase show "not set up yet").
