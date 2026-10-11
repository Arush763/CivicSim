# Cloud submissions and laptop processing

The `cloud-requests` branch combines the phone app with the latest server. Phones save private
drafts and submit requests directly to Supabase. The server on the laptop polls and leases the
shared jobs, verifies geometry, calculates costs, builds the 3D model, calls Gemini and uploads
JPEG previews. Both clients read the same proposal. Nobody has to transfer files manually.

## Enable on the existing CivicSim project

1. **Done on 11 October 2026 for the live CivicSim project.** For another existing project, apply
   `supabase/cloud-upgrade.sql` once in Supabase's SQL Editor. It contains **only** the phone-app,
   cloud and cloud-hardening migrations; it preserves the existing project and accounts.
   Do not rerun `setup.sql` on an existing database. `setup.sql` is for an empty project.
2. `server/.env` needs the existing Supabase URL and service-role key, Maps/Vertex settings,
   and Chrome. `CLOUD_WORKER=1` is the default; `0` pauses cloud processing.
3. `phone/.env` needs the same Supabase URL and the **public anon key**. It has been populated
   from the existing mobile configuration where available. No service key goes into the phone.
4. Check `node scripts/cloud-status.mjs`, then start `npm start` (server and ngrok tunnel; or
   `npm start -w server` for the server alone) and `npm start -w phone`. The existing admin panel
   starts with `npm run web -w adminpanel`.

Ngrok serves the phone's interactive Street View / 3D tabs and local-only mode. `npm start` opens
the tunnel and writes its URL to `phone/.env`; it needs `ngrok config add-authtoken <token>` once.
Cloud submissions, votes, feeds and saved JPEG previews do not need it. The laptop's admin
panel still runs locally and enforces admin permissions for decisions and processing retries.

## What works while the laptop is offline

- Browse saved requests and preview images, vote, sign petitions, and submit drafts in zones
  whose scene has already been loaded into `zone_scenes`.
- A new zone is queued for its first OpenStreetMap fetch. Its streets/buildings become available
  when the laptop processes that zone. Opening it waits up to a minute, then offers a retry.
- Rendering waits until the laptop returns; submitted requests remain saved. Phones can close
  the app after submission and see the finished result on their next visit.
- Interactive Street View/3D still uses the laptop. Saved images are the default, and compare
  shows before and after side by side. Publishing a separate public interactive viewer would
  require hosting its pages and assets; this integration does not deploy a new public website.

## Queue and permissions

Drafts are private to their owner. `submit_request` atomically creates the proposal and its job,
and retrying submission returns the same proposal id without extra points. Clients cannot claim
jobs (the queue functions are executable by the service key only), write costs/output URLs, generate AI edits, or decide requests. The worker verifies the
shared change-op schemas and references before paid work.

Jobs have a 90-second lease, renewed every 20 seconds. Expired jobs can be reclaimed after a
crash. Completion requires the current lease token; transient failures retry with backoff up to
five attempts. Daily AI limits defer until midnight UTC without exhausting retries. Models and
snapshots have immutable, content-addressed Storage paths. External API calls cannot be made
transactional with the queue; an interrupted generation may need repeating. Existing cached
outputs and the daily cap limit repeat work.

The laptop panel receives proposal updates through Realtime and reconciles once per minute.
An admin can choose **Retry preview** after processing fails. There is a maximum of ten pending
submissions per user and ten pending new-zone jobs per user. These limits do not replace the
global daily paid-edit cap.

## Usage estimates (11 October 2026)

Run `node scripts/usage-report.mjs` to remeasure. Current samples:

- 89 cached model sets: mean **0.434 MB** for all three LOD files.
- 12 recorded prepared edits: mean **0.444 MB** each; fifteen directions total **6.667 MB**.
- Six cached source photographs, screenshot locally at the actual 960×720 / JPEG78 output
  settings: **0.674 MB** total. This is a representative snapshot estimate, not six completed
  proposal snapshots. Actual sizes depend on scene detail. 3D stills are generally smaller.

| Scenario | Approx. data per request | Requests retained in 1 GB |
| --- | ---: | ---: |
| This integration: model + six saved previews | 1.108 MB | 902 theoretical; plan around 700 with headroom |
| Also upload all fifteen full interactive edits (not enabled) | 7.775 MB | 128 theoretical |

Storage is the total retained amount, not a monthly upload count. Replacing a file does not add
another copy, but different requests and different snapshot hashes do. No automatic retention
cleanup is configured. Other files and existing usage reduce available capacity.

Supabase Free includes 1 GB file storage, 5 GB uncached egress and separately 5 GB cached
egress per month, plus a 500 MB database. The two egress allowances are separate limits; do not
assume any traffic can consume a combined 10 GB. A 5 GB allowance covers about **7,400 complete
six-image downloads** at the sample sizes, or roughly **22,000 two-image comparisons**, before
other traffic. Repeated device/CDN cache hits can reduce downloads. Supabase Pro starts at
$25/month and includes 100 GB storage. Sources: [pricing](https://supabase.com/pricing),
[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Ngrok Free's 1 GB monthly outbound allowance would cover about **128 full 7.775 MB downloads**,
before other traffic. It is not an upload/publish limit, and the cloud image path bypasses ngrok.
Source: [ngrok limits](https://ngrok.com/docs/pricing-limits/free-plan-limits).

Gemini 3.1 Flash Image / 1K output is about $0.067 per image, so fifteen outputs are about
**$1.01**, plus input/reasoning tokens and Maps charges. Supabase's free allowance does not pay
for Gemini. `AI_DAILY_LIMIT=100` permits six complete fifteen-edit requests plus ten remaining
edits daily, shared with other generation. A smaller request uses fewer edits, and saved views
cost no new generation. Source: [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing).

## Verification

`npm test` covers the SQL ownership rules, atomic/idempotent submission, lease expiry and
reclaim, stale completion refusal, retry behavior, worker lease loss and existing rendering.
`npm run typecheck` checks all workspaces. New paid generation is mocked in tests.
Use a real phone for final device/performance checks; a successful bundle is not a device test.
