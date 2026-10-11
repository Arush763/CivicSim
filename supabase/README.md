# Supabase setup

**Cloud request integration:** [Setup, offline behavior and measured usage limits](../docs/CLOUD_REQUESTS.md). Phones now submit through Supabase; the laptop processes queued requests and uploads saved previews.

Supabase holds the shared data: accounts, requests that people have confirmed, confirm/deny votes, petitions and points. Supabase Storage holds each request's 3D model.

Phone drafts and shared processing jobs live in Supabase. The laptop keeps its scene-render cache and full interactive photo-real edits locally, and uploads JPEG snapshots and 3D models for cloud viewing. Admin-created drafts remain local until submitted.

Until Supabase is connected, everything runs in **local-only mode** on the server computer. Nothing is lost by switching later, but requests made in local-only mode stay local.

## What's in this folder

| File | What it is |
|---|---|
| `setup.sql` | **The one file to import.** Every table, rule, trigger, the leaderboard view and the storage bucket. |
| `cloud-upgrade.sql` | Apply once to the existing CivicSim project to add the phone schema and cloud queue. |
| `migrations/` | The same thing split into steps, for the Supabase CLI. `setup.sql` is built from these. |

## 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard), then **New project**.
2. Pick a name and a strong database password (save it somewhere). Pick the region closest to you.
3. Wait about 2 minutes for it to start.

## 2. Import the database

1. In the project, open **SQL Editor**, then **New query**.
2. Open `supabase/setup.sql`, copy all of it, paste it in and click **Run**.
3. It should say *Success. No rows returned*. Check **Table Editor**: you should see `profiles`, `areas`, `area_issues`, `proposals`, `proposal_votes`, `petitions`, `petition_signatures` and `point_events`. **Storage** should have a `renders` bucket.

Run it once, on a new project. Running it a second time fails, because the tables already exist.

**Or, with the Supabase CLI:**

```sh
supabase link --project-ref <ref>
supabase db push
```

This runs the files in `migrations/` in order.

## 3. Turn on email sign-in with a code

People sign in with a 6-digit code sent by email. There are no passwords.

1. Go to **Authentication**, then **Sign In / Providers**, and make sure **Email** is on.
2. Go to **Authentication**, then **Emails**, then **Magic Link**. Make sure the template includes the code: `{{ .Token }}`. For example:

   ```html
   <h2>Your sign-in code</h2>
   <p>{{ .Token }}</p>
   ```

3. Supabase's built-in email sender is limited to a few emails an hour. For anything beyond testing, add your own SMTP under **Project Settings**, then **Authentication**.

## 4. Put the keys in the .env files

Find the keys under **Project Settings**, then **API** (or **API Keys**).

**`server/.env`** (on the server computer only):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key>
```

**`mobile/.env`** (the app; this key is public by design):

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

The **service-role key can do anything**. Keep it in `server/.env` only. It must never go in `mobile/.env`, in a URL or in git. Both `.env` files are already in `.gitignore`.

## 5. Make yourself a city admin

The desktop app is the **city admin panel**, and only admins can sign in to it.

1. Start the server and the panel.
2. Sign in once with your email, so your account exists. The panel will say the account isn't an admin yet.
3. In **SQL Editor**, run this with your own email:

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

4. Reload the panel. It takes up to a minute for the server to notice.

## 6. Restart and check

Restart the server (`scripts/start.sh`, or `npm start -w server`). Then open `http://localhost:3000/health`. It should show `"mode":"supabase"`.

From then on:

- **Confirming a request** uploads its 3D model to the `renders` bucket and adds a row to `proposals`. The zone is added to `areas` the first time it's used, anywhere in the world.
- **Photo-real progress** is written to `proposals.photo_status` (`queued`, `running`, `done`, `failed` or `skipped`) and to `photo_spots`. Any app can show "Preparing…" or "Ready" from these.
- **Decisions** (accept, reject, reopen) come only from the admin panel on the server computer. The database refuses status changes from anyone else, admins on phones included. The server writes them with the service key.
- **Votes, petitions and signatures** come straight from the apps. Row-level security limits each person to their own.

## Who can do what

| | Phone app (later) | Admin panel (browser on the server computer) |
|---|---|---|
| Browse zones, requests, leaderboard | yes | yes |
| Make a request, confirm or deny, sign petitions | yes (signed in) | yes |
| See photo-real views | yes, the ones prepared ahead of time | yes |
| Make new photo-real edits (AI) | **no** | yes |
| Get AI ideas for a zone | **no** | yes |
| Accept or reject requests | **no** | yes (admins) |

The server enforces this, not just the apps. Anything that comes through ngrok or from another device on the network is never treated as admin. To allow admins on other computers, set `ADMIN_REMOTE=1` in `server/.env`.

## Changing the database later

1. Add a new file to `migrations/`, named `YYYYMMDDHHMMSS_what.sql`.
2. Rebuild the single file:

   ```sh
   node scripts/supabase-sql.mjs
   ```

3. On an existing project, run **only the new migration file** in the SQL editor, or use `supabase db push`. `setup.sql` is only for new projects.

The server tests check that `setup.sql` matches the migrations and runs cleanly.
