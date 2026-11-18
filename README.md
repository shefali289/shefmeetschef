# ShefMeetsChef

Recipes, reels and remixes from @shefmeetschef.

## Run it locally

You need Node 22.

```sh
npm install
cp .env.example .env.local   # optional: leave it empty to use sample recipes
npm run dev                  # http://localhost:3000
```

Other commands: `npm test` (unit, component and database tests), `npm run test:e2e` (browser
tests), `npm run check` (everything CI runs).

With no `.env.local` the site runs on the bundled sample recipes, and sign-in and `/admin` show
"not set up yet". To turn them on, copy `.env.example` to `.env.local` and fill in the values.

## Supabase Auth setup

- Enable the Google provider and email (magic link) sign-in in Supabase Auth.
- Under Authentication > URL Configuration, add the callback to the redirect allow-list, for
  every site address you use: `https://<site>/auth/callback**` (and
  `http://localhost:3000/auth/callback**` for local development). Without it Supabase refuses
  the redirect and sign-in fails.
- Also allow deploy previews: `https://*--<site>.netlify.app/**`, and set "Site URL" to your
  production address.

## Deploy (first time)

Do these in order.

1. **Database.** In your Supabase project's SQL editor, run each file in `supabase/migrations`
   in name order (task 1: `20261117...0001` to `...0005`; task 2: `20261118...0001` to `...0006`).
   Already deployed task 1? Run only the new `20261118...` files, in order. Or with the Supabase CLI:
   `supabase link --project-ref <ref>` then `supabase db push`.
2. **Netlify environment variables** (Site configuration > Environment variables), before the
   first real build: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_SITE_URL`, and the server-only keys `GEMINI_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`,
   `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`. Never prefix the server-only keys with `NEXT_PUBLIC_`.
   `NEXT_PUBLIC_*` values are baked in at build time, so after changing them use
   "Clear cache and deploy site".
3. **Sign in once** on the live site (this creates your profile), then make yourself admin in the
   SQL editor:

   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```

4. Open `/admin` and press **Import now**. Each run drafts up to 3 posts, to stay inside Gemini's
   free rate limit and Netlify's time limit; press it again for the rest.

Posts whose caption has no recipe, or that Gemini can't turn into a valid recipe, are remembered
and not retried. To retry them:

```sql
delete from public.import_skips;            -- everything
delete from public.import_skips where reason = 'failed';   -- only failed ones
```

## Task 2 features (Ask Shef, outside reels, cookbook)

- **Ask Shef** (on each recipe page) and **Add a reel** (`/add-reel`) need `GEMINI_API_KEY` and
  Supabase. Without them they show "not set up yet".
- Free limits are enforced in the database: 10 Ask Shef questions a day and 5 outside reels a
  month (NZ time), 30 cookbook saves. Outside reels don't count toward the 30 saves.
- Outside reel recipes are private to their owner (404 for everyone else) and never appear in
  search. Owners can delete them from "My reels" in `/cookbook`; deleting doesn't give the reel back.
