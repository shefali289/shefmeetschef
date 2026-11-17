# Task 1 brief: foundation and Shef's recipes

Source plan: "ShefMeetsChef app plan" (Shefali's plan doc). Hosting: Netlify. Storage: Supabase Storage.

## In scope

1. **Database (Supabase migrations in `supabase/migrations`)** for the whole v1 data model, so later
   tasks only add policies/features: `profiles` (name, avatar_url, diet_prefs, is_admin, plan),
   `recipes` (slug, title, description, reel_url, youtube_url, cover_image_url, source `shef|outside`,
   owner, ingredients jsonb [{qty, unit, item, note}], steps jsonb, base_servings, prep/cook minutes,
   cuisine, diet_tags text[], allergens text[], categories text[], status `draft|live`, instagram_id,
   youtube_id, timestamps), `folders`, `saves`, `remixes`, `likes`, `challenges`, `usage`.
   RLS on every table. Anyone (anon) reads live `shef` recipes only. Only admins insert/update/delete
   Shef recipes and see drafts. Users read/write only their own profile (cannot set is_admin or plan),
   folders, saves. A trigger creates a profile on sign-up. Storage buckets: `recipe-images` public read,
   admin write; `remix-photos` and `drafts` private.
   Tests: PGlite runs all migrations with a stubbed `auth` schema (`auth.uid()` from a session setting,
   `anon`/`authenticated` roles) and proves each policy for anon, a normal user, another user and admin.
2. **Recipe card page `/recipes/[slug]`**: title (script font), embedded Instagram reel and/or YouTube,
   servings slider 1 to 12 that scales ingredient quantities (nice fractions, e.g. 1.5 -> 1 1/2, units
   kept), diet tags with colours, allergen warning box plus "check labels if you have an allergy",
   steps, "Watch the reel", "Watch on YouTube", "Follow @shefmeetschef" buttons, Google Recipe JSON-LD,
   share metadata. Server-rendered for SEO.
3. **Home page and branding**: burnt orange, cream, navy, herb greens; script title font (e.g. Google
   "Pacifico" or similar) plus clean sans; logo wordmark "shefmeetschef"; hero "Hi, I'm Shef" with an
   avatar placeholder (Shefali will supply the illustration); tagline "Raw plates, honest bites & foodie
   experiments"; About Shef "Very raw, unfiltered homemade food, no fancy plating". Recipe grid.
4. **Search and filters** on `/recipes`: text search on title/ingredients; filters for cuisine (Indian,
   fusion, Italian, Chinese), categories (healthy, air fryer, drinks, desserts, festival specials, kids and
   parties), diet tags (veg, vegan, halal, gluten free). Filters live in the URL query so links share.
5. **Data layer** with a sample-data fallback: when Supabase env vars are missing, the site uses
   `src/lib/sample-recipes.ts` (a few realistic sample recipes) so it previews with no setup.
6. **Sign-in**: Supabase Auth (Google and email magic link) pages and session handling with
   `@supabase/ssr`; header shows sign in / sign out. Hidden gracefully when Supabase is not configured.
7. **Admin import** (`/admin`, admins only, enforced server-side):
   - Gemini caption parser: a pure function that sends the caption to Gemini (`gemini-2.5-flash` via
     REST, JSON schema output) and validates the result with zod into a draft recipe (title, ingredients,
     steps, servings, cuisine, diet tags, allergens, categories). Unit-tested with a mocked fetch.
   - Instagram fetcher (Instagram API with Instagram Login, `/me/media` with caption, permalink,
     media_type, thumbnail_url) and YouTube fetcher (Data API v3 channel uploads + description).
     Unit-tested with mocked fetch.
   - "Import now" server action: fetch new posts, skip ones already imported (by instagram_id /
     youtube_id), parse, save as drafts. Admin list of drafts; edit form; Publish button.
   - All keys server-only.

## Out of scope (later tasks)

Ask Shef chat, outside reels, cookbook UI, remixes, challenges, moderation, daily scheduled import,
emails, legal pages, monitoring, backups, PWA.

## Constraints

- See CLAUDE.md. Free tiers only. No secrets in repo. Strict TDD.
- No docker in the build environment: DB tests use PGlite.
