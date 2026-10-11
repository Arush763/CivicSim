# CivicSim (Mamdani AI): project guide and known issues

**Cloud request integration — implemented locally, database upgraded:** The `cloud-requests` branch combines the phone app and server. The new flow saves phone submissions in Supabase, lets the laptop process them with Gemini, and shares saved previews back to both apps. [Setup, offline behavior and measured usage limits](CLOUD_REQUESTS.md).

**Handoff status (11 October 2026):**

- Implemented private cloud drafts, idempotent submission, a durable queue with leases/retries, laptop processing, saved JPEG previews, and admin updates/retry controls.
- Verified: 102 tests passed (12 shared + 90 server); nine pilot-fixture tests skipped. All workspace typechecks and the Android phone export passed. Full lint still reports existing hook/UI issues.
- **Applied to the live database (11 October 2026):** migrations `phone_app`, `cloud_requests` and `harden_cloud_functions`, through the Supabase MCP. `node scripts/cloud-status.mjs` reports the cloud schema ready.
- `harden_cloud_functions` closes a gap found right after applying: Supabase grants execute on new functions to `anon` and `authenticated` directly, so the worker's queue functions (claim, renew, finish, retry) were callable from the apps. They are now service-key only.
- **ngrok:** installed at `~/.local/bin/ngrok` (v3). `npm start` (`scripts/start.sh`) starts the server and the tunnel and writes the tunnel's URL into `phone/.env`. Still needed once: `ngrok config add-authtoken <token>`. The tunnel has not been run yet.
- Next action: add the ngrok token, run `npm start`, then `npm start -w phone`, and test a phone submission → laptop Gemini processing → saved preview, and the Street View / 3D tabs through the tunnel. No live round trip has been verified yet.
- `origin/phone-app` (motion, Google Sans, wait-for-photo-real, Android test build) is merged in. The cloud work is committed and pushed, on both `cloud-requests` and `main`.

Status as of **11 October 2026 (night)**. This guide covers:

- what the project is;
- how each part works;
- how to run it;
- what is currently broken, unfinished or risky.

The quick-start is in the [README](../README.md). Supabase setup is in [supabase/README.md](../supabase/README.md).

---

## Contents

1. [What it is](#1-what-it-is)
2. [Who uses what: admin panel and phone app](#2-who-uses-what-admin-panel-and-phone-app)
3. [How people use it](#3-how-people-use-it)
4. [Architecture](#4-architecture)
5. [Repository layout](#5-repository-layout)
6. [Zones: the worldwide grid](#6-zones-the-worldwide-grid)
7. [Map data: OpenStreetMap and NYC 311](#7-map-data-openstreetmap-and-nyc-311)
8. [Changes (change ops)](#8-changes-change-ops)
9. [3D scene building and the render queue](#9-3d-scene-building-and-the-render-queue)
10. [Street View before/after](#10-street-view-beforeafter)
11. [Photo-real views (Gemini on Vertex AI)](#11-photo-real-views-gemini-on-vertex-ai)
12. [Render times: planning guide](#12-render-times-planning-guide)
13. [Cost estimates](#13-cost-estimates)
14. [AI ideas (Claude)](#14-ai-ideas-claude)
15. [Voting, decisions, petitions, points](#15-voting-decisions-petitions-points)
16. [The app (Expo)](#16-the-app-expo)
17. [Server API](#17-server-api)
18. [Configuration and keys](#18-configuration-and-keys)
19. [Running it](#19-running-it)
20. [Tests](#20-tests)
21. [Costs of running it](#21-costs-of-running-it)
22. [Current issues](#22-current-issues)
23. [Suggested next steps](#23-suggested-next-steps)

---

## 1. What it is

An app where residents propose physical changes to their city, and everyone sees what those changes would really look like before anything is built. Examples:

- a protected bike lane or a bus lane;
- street trees or a park;
- a wider sidewalk or a crosswalk;
- replacing a low building with affordable housing.

**Anywhere in the world.** The map is split into ~200 m zones. Any zone can be opened, and its streets and buildings are loaded from OpenStreetMap the first time.

**People decide; AI only suggests.**
- Claude can suggest ideas for a zone (admins only). Each idea opens as an editable draft labelled "AI suggested", and nothing is submitted until a person confirms it.
- The final decision on every request is made by a city admin.

**See it before it happens.** Each request is shown in Google Street View, with the change **built into the real photos** by Gemini. You can look around and walk while you see it. The views are prepared as soon as the request is submitted.

**Honest numbers.** Every request has a cost estimate from a fixed unit-cost table. The AI never invents a cost. (The table still uses placeholder figures; see [issues](#22-current-issues).)

**Civic process.**
- Residents confirm or deny requests.
- A city admin approves or rejects them.
- Requests can become petitions.
- Taking part earns points and ranks on a leaderboard.

---

## 2. Who uses what: admin panel and phone app

There are two apps with different jobs.

| | **Admin panel** (desktop, `mobile/`) | **Phone app** (`phone/`) |
|---|---|---|
| Who | City board and other officials who decide on requests | Residents |
| Where it runs | In a browser **on the server computer** (the laptop that runs the server) | On phones, saving requests and reading previews through **Supabase**; ngrok is optional for interactive previews |
| What it's for | Reviewing requests, deciding on them, AI tools | **Making requests only**, and confirming, denying or signing others' |
| AI ideas (Claude) | yes | **no** |
| New photo-real edits (Gemini) | yes | **no** (sees only the views prepared ahead of time) |
| Accept or reject requests | yes | **no** |

**Why the laptop is the worker.** The laptop runs the server, the hidden browser that prepares photo-real views, and the admin panel. Phones save submissions in Supabase's durable queue. The laptop picks up jobs and uploads finished images, which remain viewable while it is offline. ngrok is optional for live Street View/3D and local-only development. New zones still need the worker for their first map-data fetch. See [cloud setup](CLOUD_REQUESTS.md) for this branch's updated flow; the low-level rendering sections below still describe the laptop's interactive viewer.

**How "admin only" is enforced** (`server/src/app.ts`, `isAdmin`), on the server, not just in the apps:

- **The request must be typed on the server computer.** Requests that come through ngrok, or from another device on the network, are never treated as admin, even with an admin's sign-in. (ngrok marks forwarded requests with `X-Forwarded-For`; requests from another device come from a different address.) To allow admins on other computers, set `ADMIN_REMOTE=1`.
- **With Supabase on, the person must also be an admin:** `profiles.role = 'admin'`. In local-only mode, whoever is at the server computer is the admin.
- **What the rules cover:**
  - Admin-only actions are AI ideas (`POST /areas/:id/suggest`), new photo-real edits (`POST /ai/render`), re-preparing views (`POST /proposals/:id/prerender`) and decisions (`POST /proposals/:id/status`).
  - Everyone else asking `/ai/render` only gets views that already exist. They get a 404 "not prepared yet" otherwise, so nothing is spent on their behalf.
  - The database itself refuses status changes from apps. Decisions are written only by the server (see [§15](#15-voting-decisions-petitions-points)).
- **Inside the app** (`mobile/src/lib/data.ts`, `useAdminState`):
  - Admin tools only appear in a browser.
  - With Supabase on, the browser app shows a sign-in until an admin signs in (`components/AdminGate.tsx`).
  - The phone build never shows admin tools.

**The phone app** is a separate Expo app in `phone/`, built from the CivicSim Mobile design (see [§16b](#16b-the-phone-app-phone)). It only makes requests, votes and petitions; it has no admin or AI features.

---

## 3. How people use it

**Residents (phone app, after the cloud migration is applied)**

1. **Find a place.**
   - Search a street or place (Google Places), or pan the map.
   - Zoom in and the zone squares appear.
   - Zones with requests are tinted: orange = waiting, green = approved, with a count badge.
2. **Open a zone** by tapping a square. The zone panel shows:
   - a plain-language description (streets, buildings, building heights);
   - for New York only, the last 90 days of 311 complaints;
   - the requests made there, most-confirmed first.
3. **Request a change** by picking one or more changes:
   - **Bike lane, bus lane, sidewalk, no parking:** tap a street.
   - **Rebuild lot:** tap a building.
   - **Park:** draw an area.
   - **Trees:** draw a line or an area.
   - **Crosswalk:** tap a spot.

   Cloud drafts save privately as you edit. The laptop calculates the cost and builds the model after submission; the phone shows the estimate as pending until then.
4. **Submit.** The request becomes public and its processing job is saved atomically in Supabase. The laptop picks it up when online. The phone can close without losing the submission.
5. **Others review it.**
   - Saved before/after images are the default, with a side-by-side comparison. Interactive Street View/3D is optional and still needs a reachable laptop server.
   - They tap **Confirm** or **Deny**.

**City admins (admin panel)**

6. **Decide.** Admins review requests (Street View, cost, votes) and **Approve** or **Reject** them. They can also ask Claude for ideas in a zone, and open any spot photo-real (new spots are built live).
7. **Petitions and points.** A request's author can start a petition, and people sign it. Points flow to the leaderboard. (These need Supabase connected.)

---

## 4. Architecture

```text
 Phone app ── HTTPS ──► Supabase ◄── read updates ── Admin panel
                         │                            │ localhost
              drafts, submissions,                   │
              leased cloud jobs,                      │
              saved models/previews                   │
                         ▲                            ▼
                         │ poll jobs / upload results │
 ┌─ Server computer (laptop): Fastify, Node 22 ─────────────────────────────────────────┐
 │  zone loader: OpenStreetMap (Overpass)        cache: server/data/zones/*.json          │
 │  NYC 311 complaints (Socrata, live)                                                    │
 │  scene builder → .glb, 3 detail levels        cache: server/cache/tiles/               │
 │  render queue (SQLite-backed)                                                          │
 │  cost engine (fixed unit costs)                                                        │
 │  Claude ideas (admins only)                                                            │
 │  Street View page (/streetview)                                                        │
 │  photo-real edits: Street View Static + Gemini on Vertex AI (admins + preparing only)  │
 │      cache: server/cache/ai/*.png                                                      │
 │  prepare-ahead: hidden Chrome opens each new request and builds its views              │
 │  drafts, prepare status, local-only data (SQLite: server/data/server.sqlite)           │
 └───────────────┬──────────────────────────────────────────────────────────────────────┘
                 │ service-role access; paid API keys stay on the laptop
                 ▼
 Supabase: accounts, requests, votes, petitions, points, cloud queue, model/JPEG storage
```

**The server computer does the heavy work:**
- fetching map data;
- building 3D scenes;
- making the photo-real edits;
- queueing;
- holding the paid keys.

The apps only display things and send requests.

**Cloud phone drafts are private rows in Supabase.** Submitted jobs wait safely while the laptop is offline. Previously loaded zones and saved previews remain accessible; a new zone needs its first map-data fetch from the worker. In **local-only mode** (no Supabase), drafts, submitted requests, votes and decisions stay on the laptop.

**Google services used:**
- the map (Maps JavaScript API in the browser, react-native-maps on phones);
- place search (Places API, New);
- Street View (Maps JavaScript API);
- Street View images for Gemini (Street View Static API);
- Gemini image models on Vertex AI (Google Cloud).

---

## 5. Repository layout

| Path | What's in it |
|---|---|
| `shared/src/` | Shared by app and server: change-op schemas (zod), domain types, geo helpers, **the worldwide zone grid** (`zones.ts`), and how a request is described and where Street View should look (`describe.ts`) |
| `server/src/app.ts` | All HTTP routes, sign-in, and the admin-only rules |
| `server/src/data/osm.ts` | OpenStreetMap zone loader: Overpass query, parsing, street merging, width measurement, urban/suburban/rural setting, cache |
| `server/src/data/terrain.ts` | Ground heights from the open AWS Terrain Tiles |
| `server/src/data/zoneIssues.ts` | Live NYC 311 complaint counts per zone |
| `server/src/data/importNyc.ts`, `importIssues.ts`, `socrata.ts`, `tiles.ts` | The original lower-Manhattan pilot import, and the tile loader that serves pilot and worldwide zones |
| `server/src/scene/` | Scene builder (`build.ts`), geometry, materials, GLB export, render cache (`render.ts`) |
| `server/src/queue/renderQueue.ts` | Background 3D render queue |
| `server/src/queue/cloudWorker.ts` | Claims Supabase jobs, renews leases, validates requests, renders and uploads previews |
| `server/src/cost/` | Unit-cost table and estimator |
| `server/src/suggest/` | Claude ideas |
| `server/src/ai/streetRender.ts` | Photo-real edits: prompt, cache, limits, busy fallbacks |
| `server/src/ai/vertex.ts` | Vertex AI client (API key or service account) |
| `server/src/ai/changeMask.ts` | Keeps only what Gemini changed (transparent PNG) |
| `server/src/ai/prerender.ts` | Prepares each new request's views in a hidden Chrome |
| `server/public/streetview.html` | The Street View before/after page: Google Street View, the photo-real edits, progress bar, prepare mode |
| `server/public/preview.html` | Desktop debug viewer for 3D render files |
| `server/src/db.ts`, `supabase.ts` | Local SQLite store; Supabase client (service key) |
| `supabase/setup.sql` | **The whole database in one file**, to paste into Supabase |
| `supabase/cloud-upgrade.sql` | Phone/cloud migrations only, for the existing CivicSim database |
| `phone/src/lib/cloud.ts` | Private cloud drafts, submission RPCs, zone polling and saved previews |
| `scripts/cloud-status.mjs`, `usage-report.mjs` | Read-only cloud readiness check and measured file-size estimates |
| `supabase/migrations/` | The same, as ordered migrations |
| `supabase/README.md` | Step-by-step Supabase setup |
| `scripts/supabase-sql.mjs` | Rebuilds `setup.sql` from the migrations |
| `scripts/start.sh` | Starts the server and ngrok |
| `mobile/src/app/` | Screens (Expo Router) |
| `mobile/src/components/` | Map, picker map, change builder, Street View, 3D viewer, admin gate, UI kit |
| `mobile/src/lib/` | API client, data access, zones, places, theme |

---

## 6. Zones: the worldwide grid

File: `shared/src/zones.ts`. The app and the server use the same code.

- **Shape.** Every point on Earth falls in exactly one ~200 m × 200 m zone.
- **Rows** are bands of equal latitude, 200 m tall.
- **Columns** are 200 m wide, measured at the middle of the 1° latitude band the row sits in. So column lines run straight within each band (~111 km) instead of shifting row to row like bricks.
- **Ids** look like `g72680_44813` (`g{row}_{col}`). Neither side needs an import step or a lookup table to agree on ids.
- **Helpers:**
  - `zoneIdAt(lng, lat)`
  - `zoneBbox(id)`
  - `zoneBlock(id)`: the zone plus its 8 neighbours
  - `zonesInView(bbox)`: for drawing the grid; it returns nothing for views too large to draw
- **Map behaviour.** The grid is drawn from zoom 15.5 upward. Zoomed out, only zones with requests are drawn.
- **Labels.** A zone is shown by its centre coordinates, e.g. "40.7262°N 73.9971°W", and a name built from its two longest streets.
- **Pilot zones.** The older lower-Manhattan pilot zones (`r09c14`-style ids) still work for requests made before the grid went worldwide. They are only drawn when they have requests.

---

## 7. Map data: OpenStreetMap and NYC 311

### OpenStreetMap (all zones)

`server/src/data/osm.ts`.

**Fetching and caching**
- The first time a zone is opened, the server sends one Overpass query for the zone *and its 8 neighbours*. The query asks for buildings, roads, parks and land use.
- Each zone is cached as `server/data/zones/{id}.json`. Zones already on disk are never overwritten, so the street and building ids that requests refer to never shift.
- Two Overpass mirrors are tried, 3 rounds each, with back-off.

**Buildings**
- Height comes from the `height` tag. Without it: `building:levels × 3.2 + 1`. Without that: 6 m for houses and sheds, **10 m** otherwise.
- Each building belongs to the zone containing its centre.

**Streets**
- Streets are clipped at zone edges.
- They're **merged** only where pieces of the same name continue straight on, so OSM fragments become pickable streets without hairpins.
- **Travel lanes** come from the `lanes` tag, or a default for the road class.
- **Parking** comes from `parking:*` tags, or 2 sides by default. Rural roads, trunk roads and living streets default to none.
- **Existing bike lanes** come from the `cycleway*` tags.
- **Width:**
  - Uses the `width` tag when mapped.
  - Otherwise it's measured from the gap between the buildings on each side, minus two sidewalks, and capped so an open square doesn't count as road.
  - **Divided roads** (a one-way with a same-named twin running the opposite way) count as one carriageway each.
- **Setting.** Each street is classified as **urban, suburban or rural**. The signals are buildings within 35 m, land use, nearby town and village centres, sidewalks, road type and speed limit. The setting decides how changes are designed and how Gemini is asked to build them.

**Parks** are clipped to each zone.

### NYC 311 complaints (New York zones only)

`server/src/data/zoneIssues.ts`.

- Zones in New York City get live counts of the last 90 days of 311 complaints (Socrata dataset `erm2-nwe9`), grouped into categories and cached for an hour.
- Zones elsewhere have no complaint data. The app says so and shows building and street counts instead.

---

## 8. Changes (change ops)

Every change is a typed **change op** (`shared/src/changeOps.ts`), checked with zod on both the app and the server. The AI suggests changes in the same format.

| Op | What the person picks | Parameters |
|---|---|---|
| `add_bike_lane` | a street | side (left / right / both), protected (posts + buffer) |
| `add_bus_lane` | a street | side |
| `widen_sidewalk` | a street | metres |
| `remove_parking` | a street | side |
| `replace_building` | a building | floors, use (affordable housing, mixed use, community centre, school, clinic), homes |
| `add_park` | an area (polygon) | name |
| `plant_trees` | a line or an area | count |
| `add_crosswalk` | a point | raised or not |

A **draft** is `{ areaId, title, description, ops[], source: 'human' | 'ai_suggested' }`. The server checks two things: every op refers to streets and buildings that exist in the zone, and its geometry stays inside the zone (with ~50 m of slack).

---

## 9. 3D scene building and the render queue

**Scene builder** (`server/src/scene/build.ts`). Turns a zone and a request into a 3D model:

- **Buildings:** extruded footprints.
- **Streets:** ribbons with a lane cross-section.
- **Changes**, applied on top:
  - lanes with edge lines and a hatched buffer, and posts;
  - red bus lanes;
  - a new building;
  - park ground and trees;
  - crosswalk stripes;
  - a wider sidewalk.
- **Designs fit the road.** Where parking stays, new lanes go beside the parked cars. If a design leaves less than 3 m per traffic lane, the buffer is dropped first, then parking on the lane's side (`fitLanes`).
- **Designs fit the place:**

  | Setting | Bike lane design |
  |---|---|
  | **Urban** | Muted green lane, edge lines, bike symbols; a buffer with flexible posts when protected |
  | **Suburban** | Plain painted lane (white lines and symbols, no green), only occasional posts |
  | **Rural** | A separate asphalt path behind a grass verge; no paint, posts or cones |

- **Props.** It also emits exact positions of posts, trees and lane symbols.
- **Deterministic.** Seeded random numbers mean the same request always gives identical geometry.

**What the model is for now.** It isn't shown to people any more. It tells Gemini exactly where each change goes (the "guides", [§11](#11-photo-real-views-gemini-on-vertex-ai)), and it's available as a "3D model" tab in the request screen.

**Export.** glTF binary (`.glb`) at 3 levels of detail (lod0 = highest), with quantised geometry. Files are stored at `server/cache/tiles/{zone}/{hash}/lod{0,1,2}.glb`. The hash covers the scene version, zone, zone data and ops. Files never change, so browsers cache them forever.

**Render queue** (`server/src/queue/renderQueue.ts`):
- runs 2 at a time, in-process, saved in SQLite so jobs resume after a restart;
- groups draft edits for 500 ms, and a newer edit replaces an older one that hasn't started;
- renders identical scenes once;
- pushes progress to the app over a WebSocket (`/ws`).

By the time someone taps Submit, the model is usually ready.

---

## 10. Street View before/after

`server/public/streetview.html`. The browser app shows it in an iframe and phones in a WebView, so there's one implementation for both.

**Finding the view**
- The page asks Google for the panorama nearest the change, preferring Google's own outdoor car photos.
- It faces the change, or looks down the street for street changes.
- It tilts up and widens the view for new buildings.

**Lining the model up with the photo** (for the guides)
- **Measured camera model.** The field of view is `2·atan(2^(1−zoom))`: zoom 0.5 → 109°, 1 → 90°, 2 → 53°. This was measured against Street View Static images of the same panorama; Google's documented `180 / 2^zoom` is only right at zoom 1.
- **Car tilt.** Street View angles are in the camera car's frame, so the panorama is tilted by the car's pitch (`getPhotographerPov`).
- **Terrain.** Ground heights come from the open AWS Terrain Tiles (`GET /terrain/:id`), and the camera sits 2.5 m above the ground. Google's Elevation API isn't used, because its terms forbid building terrain models from it.
- **Lane alignment.** Where the camera car's lane is predictable, new street markings slide sideways to match the real road. That is mid-road on a one-lane street, or the right-hand lane of a two-way road (left-hand where traffic keeps left).

**Controls**
- **Before / Compare / After.** Compare is a draggable slider.
- **Moving.** Drag to look around, and tap the street to walk. The edits fade out during Google's walk animation and come back for the new spot.
- **No Street View** at a place: the request screen offers the "3D model" tab instead.
- **Debug.** `?debug=1` draws the 3D model over the photo (existing buildings as wireframes, the modelled roadway in yellow) to check alignment.

**Keys.** The page gets its Maps key from the server (`GOOGLE_MAPS_BROWSER_KEY`), written into the page. The key never appears in a URL, and request logs show `key=[hidden]`. The viewer's sign-in token is passed after `#` for the same reason.

---

## 11. Photo-real views (Gemini on Vertex AI)

Files:
- `server/src/ai/streetRender.ts`, `vertex.ts`, `changeMask.ts`, `prerender.ts`;
- the photo-real section of `server/public/streetview.html`.

### How a spot is made photo-real

1. **Guides.** When you stop at a spot, the page renders the request's 3D model on black in four directions around you, starting straight down the street. Each is a 120° square view, aimed 10° down. These are the *placement guides*.
2. **Only what's visible.** For each direction, the page works out which changes can actually be seen there, by drawing each kind alone at low resolution. Directions with nothing to change are skipped.
3. **The edit.** For each remaining direction, the server fetches the same Street View image (Street View Static API) and sends Gemini:
   - the photo;
   - the guide;
   - a short brief for only the changes visible there, written for the setting (urban, suburban or rural), without counts.

   Two things were tried and dropped:
   - Asking for every change in every direction made Gemini invent things.
   - Sending a neighbouring edit as a "reference" made Gemini copy that view's layout.
4. **Only what changed is shown.** The server compares Gemini's edit with the original after matching overall colour. It keeps the differences that fall in a generous zone around the planned change, and saves a PNG that's transparent everywhere else (`changeMask.ts`). Everywhere else you see Google's sharp original photo.
5. **Look around freely.** The four edited photos are wrapped around you like the panorama, tilted with the camera car, and redrawn in the same frame as Street View. Turning and zooming cost nothing and don't lag.
6. **Saved for good.** Every edit is saved in `server/cache/ai/`. The cache key is the panorama, direction, change and model path, so the browser panel and phones share them.

### Loading bar and pointing at the change

**Plain Street View is never shown in After or Compare.** It would look like nothing changed. The page opens on a grey loading screen and is revealed only once the edits are up, already facing the change. Until then the loading screen says why:
- still being prepared;
- today's limit was reached;
- the change can't be seen from the nearest photo;
- an error, with a "Try again" button.

It checks every 10 s and shows the view as soon as its edits exist. Walking past the last prepared viewpoint, or out of the zone, takes you back, so you never land on a plain spot. Choosing **Before** shows the plain photo, on purpose.

While a spot is being made, a progress bar shows:
- how far along it is;
- how many directions are ready (e.g. "2 of 3");
- **about how many seconds are left**.

The estimate starts at ~22 s for a fresh spot and adjusts to how long spots actually take on that computer. It says so when Google is busy. A prepared spot shows "Checking saved views…" for a moment and then fills.

When it's done, **the view turns to face what changed** and a ring with a label (e.g. "New bike lane") marks it for a few seconds. The page finds the change from the edits themselves: the direction where the most of the photo changed, and the densest patch of change there, kept to a comfortable tilt. If you're holding the view at that moment, it doesn't turn.

### Prepared ahead of time

**Viewpoints across the zone are prepared, so walking around never waits and never spends.** Each Street View spot is a separate photo that needs its own edits, and a zone has ~150 spots. Editing them all measured ~400 edits (~$20) for one park, so only *viewpoints* are prepared.

When a request is submitted, the server opens its Street View page in a hidden Chrome in *prepare* mode (`prerender.ts`, `?prepare=N&edits=M`):
- **Order.** It walks the Street View spots inside the request's zone (plus a 30 m margin for streets on its edge), link by link, starting from the spot nearest the change.
- **What counts as a viewpoint.** A spot is a viewpoint when the change fills at least 2% of some direction, and there's no viewpoint within 25 m already. Each direction where the change fills at least 1% is edited.
- **Budget.** It stops when the request's edit budget is used: `PRERENDER_EDITS`, default **15**, about **$0.50–1.50 per request**. A viewpoint gets all its directions or none. Edits already made count towards the budget, so re-preparing only fills in what's missing.
- **Speed.** Edits are made 6 at a time while the walk carries on, so a request is ready **about a minute** after it's submitted.
- **Measured (fake edits):** a park visible from the whole zone got 4 viewpoints and 13 edits.
- It runs exactly the same page code as a viewer, so the saved edits are the ones viewers will ask for.
- **Every edit is listed** in SQLite (`ai_edits`: model, spot, direction, where the photo was taken, image URL). `GET /ai/edits?model=…` returns the list, and the viewer loads it when it opens.

**Walking goes from viewpoint to viewpoint.** A step that lands between viewpoints carries straight on to the next one (`stepToViewpoint`). It only ever moves onwards and only within 45 m, so you move in ~25–30 m hops and everywhere you stand is ready. The viewer:
- shows the saved edits at once, without working anything out or asking for anything;
- downloads the edits of nearby viewpoints before you get there.

Measured: each step took about 0.8 s with **no edits requested**. Away from the change, where there are no viewpoints, you walk normally: there's nothing to show there.

**You can't leave the zone.** In Street View, walking past the zone's edge (plus the 30 m margin) takes you straight back, with "That's the edge of this zone". The zone's box comes from `GET /areas/:id/bbox`.

- Progress is kept in SQLite (`GET /proposals/:id/prerender`). With Supabase on, it's also written to the request's `photo_status` and `photo_spots`, so any app can show "Preparing…" or "Ready".
- `POST /proposals/:id/prerender` re-prepares a request (admins only).
- The hidden browser signs in with a private token that changes every time the server starts.

### Model and provider

**Provider:** Vertex AI on the Google Cloud project, billed to the project and its credits. It needs either:
- `VERTEX_API_KEY` (a key bound to a service account with the *Agent Platform / Vertex AI User* role) plus `VERTEX_PROJECT`; or
- a service-account JSON key at `server/vertex-key.json`.

An AI Studio `GEMINI_API_KEY` is the fallback.

**Model:** `gemini-3.1-flash-image` at **1K**, with default thinking. These were chosen by comparing options on the same edit:

| Option | Kept the original | Notes |
|---|---|---|
| 2.5 Flash Image | 0.37 | Put trees in the gutter; softer |
| **3.1 Flash Image, 1K** | **0.71** | Trees on the sidewalk; sharp; ~15 s |
| 3.1 Flash Image, 2K | 0.72 | Same quality, ~34 s |
| 3.1 Flash Image, minimal thinking | 0.39 | Only 0.5 s faster, clearly worse |
| 3 Pro Image | 0.72 | Removed a barrier it wasn't asked to; slower and pricier |

Edits are stored at up to 1536 px, about Google's own sharpness for a 120° view.

**When Google is busy.** Vertex shares capacity between all its customers. A "busy" reply (429) isn't billed. When the main model is busy, the server rotates through the fallbacks, cheapest first, 0.1 s apart:
1. `gemini-3.1-flash-lite-image` (~8 s; photo-real but less precise);
2. `gemini-2.5-flash-image`;
3. the main model again.

It gives up after `VERTEX_BUSY_LIMIT_MS` (60 s). Edits made by a fallback model are logged.

### Safeguards

- **Admin-only spending.** Only the admin panel on the server computer and the server's own prepare step can start a new edit. Everyone else, including phones, only gets saved edits ([§2](#2-who-uses-what-admin-panel-and-phone-app)).
- **Keys.** The paid keys stay on the server and never reach a browser.
- **Same-origin check.** Edits are only accepted from the server's own Street View page.
- **Limits:**
  - at most 20 new edits a minute;
  - at most `AI_DAILY_LIMIT` (default 100) a day, counted in SQLite so a restart doesn't reset it;
  - **at the limit, only new edits stop.** Spots already made keep showing with no error message. A spot not made yet says "This spot hasn't been made photo-real yet". Preparing carries on and lists every saved edit, then reports how many edits are still to make. Prepare again after the reset (midnight UTC).
  - identical requests are merged into one.
- **Test mode.** `AI_FAKE=1` stands in for Gemini, for testing without cost.

> **Terms-of-service warning.** Editing Street View images goes against the Google Maps Platform terms, section 3.2.3(c): "Customer will not create content based on Google Maps Content." Google could suspend the Maps key or project. This was a deliberate choice by the project owner.

---

## 12. Render times: planning guide

Measured on the development laptop through Vertex AI:

| What | Time |
|---|---|
| One direction, `gemini-3.1-flash-image` (main) | ~15–20 s |
| One direction, Lite fallback | ~8 s |
| One direction, 2.5 fallback | ~10 s |
| **A fresh spot** (1–4 directions, made side by side) | **~20–25 s** (longer when Google is busy, up to ~60 s) |
| **Preparing a request** (up to 15 edits, 6 at a time) | **about 1 min** after it's submitted (longer when Google is busy) |
| Opening a prepared request (page, Street View, saved edits) | ~3.5–6 s |
| Walking to the next viewpoint (~25–30 m on) | **~0.8 s** (Google loading the photo; the edits are already downloaded) |
| Walking to a spot past the prepared viewpoints (admin panel) | ~20–25 s, built live |
| Turning, zooming, revisiting | instant, free |

**For a demo or a meeting:**
- Submit the requests **a few minutes before** showing them (check `GET /proposals/:id/prerender` for `done`). Then they open in a few seconds, and walking between viewpoints is instant.
- ngrok doesn't change these times. The time is Gemini's.

---

## 13. Cost estimates

`server/src/cost/estimate.ts` and `unitCosts.ts`.

- **Quantities** are measured from the geometry: lane length per side, park area, number of trees, new floor area, sidewalk area, kerb length.
- **The total** is each quantity times a unit cost, plus 20% contingency. The range shown is −30% to +50%.
- **AI ideas** are priced by the same function, so the AI never invents a cost.

**All unit costs are placeholders marked `VERIFY`.** Examples: protected bike lane $1.5M per mile per side, street tree $3,500, affordable home $600k, park $250/sq ft. They're New York-scale guesses, used for every city.

---

## 14. AI ideas (Claude)

`server/src/suggest/claude.ts`. Optional; needs `ANTHROPIC_API_KEY`. **Admin panel only.**

- "Get AI ideas for this zone" sends Claude (`claude-opus-5-5`, structured output) a compact summary of the zone:
  - streets, with ids, lengths, widths, lanes and existing bike lanes;
  - low buildings that could be redeveloped;
  - complaint counts.
- Claude returns 1–3 ideas with reasons, using only ids from the summary.
- The server turns them into change ops, drops anything that doesn't fit the zone, and prices them.
- Ideas open as normal drafts labelled "AI suggested". Nothing is submitted automatically.

---

## 15. Voting, decisions, petitions, points

**Database:** [`supabase/setup.sql`](../supabase/setup.sql), built from `supabase/migrations/`. Setup steps are in [supabase/README.md](../supabase/README.md).

**Live project:** **CivicSim** (`zkkdjaqxvsqvbzkpqsae`, `https://zkkdjaqxvsqvbzkpqsae.supabase.co`), in its own CivicSim organization, installed through the Supabase MCP on 11 October 2026. It has seven migrations, the same as the repo (the last three, `phone_app`, `cloud_requests` and `harden_cloud_functions`, were applied on 11 October 2026 and carry the live project's own timestamps). The first four:

| Migration | What it does |
|---|---|
| `init` | Tables, row-level security, points triggers, leaderboard view, `renders` storage bucket |
| `photo_status` | `photo_status`, `photo_spots`, `photo_updated_at` on requests |
| `decisions_server_only` | Turns the "admins update status" rule off (`using (false)`), so only the server, with the service key, can change a status |
| `harden_functions` | Fixes `rank_for`'s search path; internal trigger functions can't be called through the API |

Supabase's security checker reports no warnings. The server and the app are both switched to it (`server/.env` and `mobile/.env`), and the project owner's account is a city admin.

**Tables**
- `profiles`: username, points, rank, role (resident / admin).
- `areas`, `area_issues`. Worldwide zones are added the first time a request uses them.
- `proposals`: ops, cost, status, 3D model URLs, confirm/deny counts, and photo-real status (`photo_status`, `photo_spots`, `photo_updated_at`).
- `proposal_votes`.
- `petitions`, `petition_signatures`.
- `point_events`.
- A `leaderboard` view.

**Statuses**
- **Requests** go `submitted` → `under_review` → `accepted` / `rejected`.
  - **Only the server changes status**, and only for an admin at the admin panel.
  - The database refuses status changes from any app, including admins signed in on phones.
- **Petitions** are `open` / `goal_reached` / `closed`, with a goal between 10 and 100,000.

**Points**, applied by database triggers:

| Event | Points |
|---|---|
| Submitting a request | +10 |
| Receiving a confirm vote | +2 |
| Signing a petition | +1 |
| Your petition reaching its goal | +50 |
| Your request accepted by the city | +100 |

**Ranks:** Resident (0), Advocate (50), Organizer (200), Council Voice (750).

**Row-level security:**
- Public rows are readable by everyone.
- People can only write their own votes and signatures.
- Points, ranks and roles can't be edited from the apps.

**Local-only mode:** requests, votes and decisions are stored on the server computer instead. Petitions, sign-in and the leaderboard need Supabase.

---

## 16. The app (Expo)

Expo SDK 57, React Native 0.86, React 19.2, Expo Router. One code base:

- **In a browser on the server computer**, it's the **admin panel**.
- **As a phone build**, it will be the request-only phone app (not built or run yet).

| Screen | File | What it does |
|---|---|---|
| Map | `app/(tabs)/index.tsx` | Google map, zone grid when zoomed in, tinted request zones, search, my-location / 2D-3D / north buttons, list of zones with requests |
| Zone | `app/area/[id].tsx` | Description, complaints or building/street counts, requests with Confirm/Deny, drafts, "Request a change", AI ideas (admins) |
| New request | `app/draft/[id].tsx` | Change builder with a real-map picker, live cost, background 3D build, submit |
| Request | `app/proposal/[id].tsx` | Street View before/after with photo-real edits (or the 3D model), description, cost, Confirm/Deny, admin decision, petition |
| Requests | `app/(tabs)/proposals.tsx` | All requests |
| Petitions | `app/(tabs)/petitions.tsx` | Petitions (Supabase) |
| Ranks | `app/(tabs)/leaderboard.tsx` | Leaderboard (Supabase) |
| Account | `app/(tabs)/account.tsx` | Sign-in with an emailed code (Supabase); dev-mode notice |

**Admin gate** (`components/AdminGate.tsx`):
- With Supabase on, the browser app shows a sign-in screen until a city admin signs in.
- A signed-in non-admin is told the panel is for admins only.
- In local-only mode there's no gate.

**Design.** A light, Google Maps-like look: white panels, blue `#1A73E8`, Roboto. Zone states are orange (waiting), green (approved) and blue (selected). Phones get a bottom tab bar; screens 1024 px and wider get a top bar and side panels.

| | Browser (admin panel) | Phones |
|---|---|---|
| Map | `@vis.gl/react-google-maps` (vector map, tilt, 3D buildings) | `react-native-maps` |
| Street View | iframe | WebView |
| 3D model | `@react-three/fiber` on WebGL | expo-gl |

---

## 16b. The phone app (`phone/`)

Expo SDK 57 with Expo Router, for iOS and Android (runs in Expo Go). Built from the "CivicSim Mobile" design, light and dark. It uses the same server and Supabase as the admin panel, and the same shared code (`@mamdani/shared`), but none of the admin panel's screens.

| Screen | File | What it does |
|---|---|---|
| Map | `app/(tabs)/index.tsx` | Map (Google on Android, Apple on iPhone), place search, Waiting / Approved / Mine filters, 2D-3D, north, my location; tap a zone for its sheet |
| Zone | `app/zone/[id].tsx` | Description, building/street/height numbers, 311 complaints (New York), your drafts, requests with up/down votes |
| New request | `app/new/[areaId].tsx` | The 8 change types on a real map, options per change, title and reason, live cost and 3D build, Save draft, Submit |
| Start a petition | `app/petition/[proposalId].tsx` | Shown after Submit: pick 2–4 snapshots (made by the laptop, see below), goal, reason, Feed preview |
| Request | `app/request/[id].tsx` | Street View Before / Compare / After (photo-real when prepared) or the 3D model, votes, share, cost, petition and signing, city decision |
| Feed | `app/(tabs)/feed.tsx` | Requests near you (or worldwide): Hot / New / Top / Petitions, "N new requests" |
| Ranks | `app/(tabs)/ranks.tsx` | Your points, rank ladder and numbers; leaderboards near you, worldwide and this month |
| Settings | `app/(tabs)/settings.tsx` | Theme, map quality (3D model detail, map buildings, shadows, frame rate), photo-real on/off, notification preference, sign out |

- **Sign-in:** email code (Supabase), then an optional username. Without Supabase it runs in local-only mode as the dev user (no petitions or ranks).
- **Street View and the 3D model** are the server's pages in a WebView: `/streetview?ui=0` (the app draws its own Before/Compare/After switch and drives `window.__sv`) and `/model` (`server/public/model.html`, which follows the map quality setting).
- **Petition snapshots.** When a request is submitted, the hidden Chrome that prepares its photo-real views (§11) also takes six still pictures for its petition: the 3D model from above and at an angle as soon as the model loads, then (at the spot nearest the change, once it's photo-real) after, close-up, down the street, and before. They're saved in `server/cache/snapshots/{id}/` (`server/src/ai/snapshots.ts`), served at `/snapshots/…`, listed at `GET /proposals/:id/snapshots`, and with Supabase also uploaded to Storage and listed on the request (`proposals.snapshots`). Without photo-real, the before, street and 3D pictures are still taken. In practice they're all ready about 20–40 s after Submit.
- **Database** (`supabase/migrations/20261012000000_phone_app.sql`): petition `reason` and `snapshots`, `profiles.notify_updates`, the `proposal_feed` view (author, petition, zone centre, Hot score), `leaderboard_near`, `leaderboard_month`, `my_stats`.
- **Notifications:** the setting is saved on the profile; nothing sends push notifications yet (that needs a development build and a push service).

## 17. Server API

| Method and path | Purpose | Who |
|---|---|---|
| `GET /health` | Mode (local-only / Supabase), whether AI ideas are on, zone count, queue length | anyone |
| `GET /areas`, `GET /areas/:id` | Zones; zone detail (fetches from OSM the first time) | anyone |
| `GET /terrain/:id` | Ground heights around a zone | anyone |
| `POST /estimate` | Price a list of ops for a zone | anyone |
| `GET/POST /drafts`, `GET/PATCH/DELETE /drafts/:id` | Your drafts. Edits queue a 3D render. | signed in |
| `POST /drafts/:id/confirm` | Submit. Stores the request (Supabase or local) and starts preparing photo-real views. | signed in |
| `GET /proposals/:id/prerender` | How far along a request's photo-real views are | anyone |
| `POST /proposals/:id/prerender` | Prepare (or re-prepare) a request's views | **admin panel** |
| `POST /proposals/:id/status` | Accept, reject, reopen | **admin panel** |
| `GET /local/proposals`, `POST /local/proposals/:id/vote` | Local-only mode requests and votes | signed in to vote |
| `POST /areas/:id/suggest` | Claude ideas (503 if not configured) | **admin panel** |
| `GET /streetview` | The Street View before/after page | anyone |
| `GET /model` | A request's 3D model (the phone app's "3D model" tab) | anyone |
| `GET /proposals/:id/snapshots`, `GET /snapshots/…` | A request's petition snapshots, and the pictures | anyone |
| `GET /ai/status` | Whether photo-real is set up, and whether this viewer may make new edits (`canGenerate`) | anyone |
| `POST /ai/render` | One photo-real edit. Same-origin only. **New edits: admin panel and prepare step only**; everyone else gets saved edits or 404. | signed in |
| `GET /tiles/...`, `GET /ai/...` | 3D files and photo-real images (never change, long cache) | anyone |
| `GET /ws` | Live 3D render progress | signed in |
| `GET /city`, `GET /preview` | Old pilot city map; debug viewer | anyone |

**Sign-in:**
- With Supabase on, routes that write need `Authorization: Bearer <Supabase access token>`.
- In local-only mode, the token (or `x-dev-user`) is taken as the user id, and defaults to `dev-user`.

**"Admin panel" means** both of these:
- the request was made on the server computer itself (not through ngrok or the network, unless `ADMIN_REMOTE=1`);
- the person is an admin (with Supabase) or anyone (local-only mode).

---

## 18. Configuration and keys

Real values go in `.env` files and `server/vertex-key.json`, which git ignores. The `.env.example` files list every setting. **Never put keys in URLs, code or commits.**

**`mobile/.env`**

| Setting | Purpose |
|---|---|
| `EXPO_PUBLIC_SERVER_URL` | The server: the ngrok URL for phones. The browser panel uses `localhost` automatically. |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase (optional). The anon key is public by design. |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser map and Places. Visible to users by design, so protect it with website restrictions. |
| `EXPO_PUBLIC_GOOGLE_MAP_ID` | Vector map style for tilt and 3D buildings (defaults to `DEMO_MAP_ID`) |

**`server/.env`**

| Setting | Purpose |
|---|---|
| `PORT` | Default 3000 |
| `ADMIN_REMOTE` | `1` lets signed-in admins use the panel from other computers. Default: server computer only. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase. The service key stays on the server computer. |
| `ANTHROPIC_API_KEY` | Claude ideas |
| `NYC_APP_TOKEN` | Higher NYC Open Data limits (optional) |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps key for the Street View page |
| `GOOGLE_MAPS_SERVER_KEY` | Fetches Street View images for Gemini. Needs Street View Static API; restrict it by IP, not by website. |
| `VERTEX_API_KEY`, `VERTEX_PROJECT` | Gemini on Vertex AI (or put a service-account JSON at `server/vertex-key.json`) |
| `VERTEX_LOCATION` | Default `global` |
| `VERTEX_IMAGE_MODEL`, `VERTEX_IMAGE_SIZE` | Default `gemini-3.1-flash-image`, `1K` |
| `VERTEX_FALLBACK_MODELS` | Default `gemini-3.1-flash-lite-image,gemini-2.5-flash-image` |
| `VERTEX_BUSY_LIMIT_MS` | Default 60000 |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | AI Studio fallback, used if Vertex isn't set up |
| `AI_DAILY_LIMIT` | Default 100 new photo-real edits a day |
| `AI_FAKE` | `1` = test without Gemini |
| `PRERENDER_SPOTS` | Spots prepared per new request (default 5; 0 = off) |
| `CHROME_PATH` | Chrome for preparing views (found automatically on Mac and most Linux) |

**Google Cloud APIs to enable:**
- Maps JavaScript API (map and Street View);
- Places API (New);
- Street View Static API;
- Vertex AI API;
- later, for store builds: Maps SDK for Android and iOS.

Billing must be on in the project; a Free Trial counts.

---

## 19. Running it

You need Node 22. On the development Mac it's installed with nvm, so run `. ~/.nvm/nvm.sh` in new shells.

```bash
npm install
npm start -w server           # server on :3000 and cloud worker
npm start -w phone            # Expo phone app
npm run web -w mobile         # the admin panel at http://localhost:8081 (on the server computer)
```

**Existing Supabase project:** the live CivicSim project already has the cloud upgrade. For another existing project, apply [cloud-upgrade.sql](../supabase/cloud-upgrade.sql), then run `node scripts/cloud-status.mjs`. Do not rerun `setup.sql` on an existing database. The server uses its service-role key; the phone uses only the public anon key. `CLOUD_WORKER=0` pauses processing; it is enabled by default.

**ngrok (the phone app's Street View and 3D tabs, and local-only mode):**
1. ngrok is installed at `~/.local/bin/ngrok` on the development Mac. Elsewhere, install it from ngrok.com.
2. Run `ngrok config add-authtoken <token>` once (the token is on the ngrok dashboard).
3. Run `npm start` (it runs `scripts/start.sh`). It starts the server and the tunnel, prints the public URL, and writes it to `phone/.env` as `EXPO_PUBLIC_SERVER_URL`.
4. Start the phone app with `npm start -w phone`. Restart it whenever the script says the URL was updated; Expo reads `.env` only when it starts.

Cloud submission and saved images do not need ngrok. Without a token the script still starts the server and says so.

To keep the same URL on every start, put the account's fixed address in `server/.env` as `NGROK_DOMAIN=your-name.ngrok-free.dev`. The free plan limits monthly data (about 1 GB out), and anything arriving through the tunnel is never treated as admin.

**Supabase:** follow [supabase/README.md](../supabase/README.md). It covers importing `setup.sql`, email sign-in, the keys, and making yourself an admin.

**Optional pilot data:** `npm run import:nyc --workspace server` imports the original lower-Manhattan pilot. It isn't required.

---

## 20. Tests

```bash
npm test            # latest run: 102 passed; 9 skipped without pilot fixtures
npm run typecheck
cd mobile && npx expo-doctor
```

| Area | What's covered |
|---|---|
| Shared | Op schemas, geo maths, ranks, zone grid |
| OSM | Tag parsing, clipping, zone splitting, caching, street merging, width from buildings, setting |
| Scene | Determinism, lanes and parking, buildings, props |
| Costs | Quantities and totals |
| Render queue | Debounce, replacement, caching, resume |
| HTTP API | Zone detail; the full draft → render → confirm → vote → decide loop; validation; the Street View page; **admin-only rules** (refused through ngrok, `canGenerate`) |
| Photo-real | Prompt (physical construction, setting, no counts), image parsing, caching, daily limit, **saved-only mode**, Vertex auth and fallbacks, change masking, prepare queue. All use fake Google and Gemini, at no cost. |
| Supabase | `setup.sql` matches the migrations and runs in PGlite. Covered: triggers, leaderboard, photo status, and **status changes refused even for admins in the apps**. |
| Cloud requests | Private draft ownership, protected fields, duplicate submission, job leasing/reclaim, stale-token rejection, retries/daily-limit deferral, and unique zone jobs. Generated upgrade SQL matches the migrations. |
| Claude | Area summary and op conversion (mocked) |

The HTTP API tests use the NYC pilot data when it's present, and are skipped when it's not.

---

## 21. Costs of running it

Rough figures; check Google's current pricing.

**Measured cloud capacity:** the current sample averages 0.434 MB for three model LODs plus an estimated 0.674 MB for six JPEG previews: about **1.108 MB per request**. On Supabase Free's 1 GB retained file storage, plan around **700 saved requests with headroom** (902 theoretical). This is total storage, not a monthly submission allowance. A 5 GB egress allowance is roughly 7,400 complete six-image downloads before other traffic. The default 100-edit daily cap allows six full 15-edit requests plus ten edits; fifteen 1K Gemini image outputs are about $1.01 plus inputs and Maps charges. Actual preview sizes vary. See [measurement details and pricing sources](CLOUD_REQUESTS.md#usage-estimates-11-october-2026).

| Item | Cost |
|---|---|
| One photo-real edit (one direction) | ~3–10¢ |
| A fresh spot (1–4 directions) | ~10–40¢ |
| **Preparing one request** | **~$0.50–1.50**, once, at submit (at most `PRERENDER_EDITS` = 15 edits) |
| Busy replies (429) | free |
| Turning, revisiting, phones viewing prepared spots | free |
| Daily cap (`AI_DAILY_LIMIT`, default 100) | ~$3–10 a day at most (about 6 requests prepared a day) |
| Google Maps: map load / Street View panorama / Static image | ~$0.007 / ~$0.014 / ~$0.007, after the monthly free amounts |
| Claude ideas | a few cents each |

**Credits.** The Google Cloud project's Free Trial credit covers Vertex AI. Nothing is charged to a card unless the account is upgraded.

---

## 22. Current issues

Ordered roughly by importance.

### Risks

1. **Gemini editing Street View breaks Google's terms (3.2.3(c)).** Google may suspend the Maps key or project. A compliant alternative would run Gemini on users' own photos.
2. **API keys were shared in plain text during development** (Maps, Gemini, Vertex). The owner decided not to regenerate them for now. They're kept out of git; rotate them before any public launch.
3. **The app's Maps key isn't restricted.** It's visible in the browser by design, so it should be limited to the app's websites and to the Maps APIs.
4. **The admin check trusts how requests arrive.**
   - "On the server computer" means "from 127.0.0.1 with no `X-Forwarded-For`". ngrok adds that header.
   - Any other proxy or tunnel put in front of the server must add `X-Forwarded-For` too, or it would be treated as local.
   - Don't expose port 3000 directly to the internet.
5. **Street View page sign-in expires.** The page keeps the token it opened with. After about an hour, a long-open page needs reopening (Supabase mode only).
6. **The repository is public** and has no licence file.

### Blocked on accounts and setup

7. **Supabase is switched on, but signing in to the panel is awkward.**
   - With Supabase on, the browser panel asks for a sign-in. Supabase's emails currently contain a **link, not the 6-digit code** the app asks for, because the templates don't include `{{ .Token }}`.
   - The link sends people to Supabase's default site address (`http://localhost:3000`, the server) rather than the panel, so it seems to do nothing.
   - Supabase's built-in sender is also limited to a few emails an hour.
   - **Fix (chosen):**
     - Add `{{ .Token }}` to the "Confirm signup" and "Magic Link" templates.
     - Set the Site URL to `http://localhost:8081` (Authentication → URL Configuration).
     - The browser panel now also signs in from the email's link (`detectSessionInUrl` on the web).
     - Admins sign in once and stay signed in. For real use, add custom SMTP.
   - Sign-in, petitions, the leaderboard, multi-user voting and storage uploads haven't been used against the live project yet. Requests made in local-only mode stayed on the laptop.
8. **ngrok needs its account token, and the tunnel hasn't been run.** ngrok is installed and `npm start` wires the URL into the phone app, but `ngrok config add-authtoken <token>` hasn't been done. Until then the phone app's Street View and 3D tabs are hidden; cloud requests and saved images work without it.
9. **The phone app (`phone/`) hasn't been tried on a real phone yet.** It typechecks, bundles for iOS and Android, and its server side (submit → photo-real → snapshots) was tested end to end, but the map, WebViews, location and Places search haven't been checked on a device. Places search needs a key without website restrictions (or one restricted to the app's bundle IDs).
10. **Maps key billing.** If the app's map shows "For development purposes only", or Street View photos look colour-inverted, the key belongs to a project without billing. Switch to a key from the billed project.

### Photo-real quality and speed

11. **Gemini sometimes places things a little differently from the plan.** It can also touch up nearby parked cars. Only changes inside the planned zone are kept, but a lane can sit a metre off the guide.
12. **Only viewpoints are prepared.**
    - Walking moves in ~25–30 m hops instead of Google's ~10 m steps.
    - A request covers up to 15 edits' worth of viewpoints, roughly 4–7 viewpoints, nearest the change.
    - Beyond them, the admin panel builds spots live (~20–25 s, and it costs), and phones show "wasn't prepared".
    - `PRERENDER_EDITS` trades cost for coverage.
13. **Edits made before the zone list existed aren't in it.** Re-prepare those requests (`POST /proposals/:id/prerender`). Spots already made are reused at no cost, so it just fills in the list and the missing spots.
14. **Edits are PNGs** (about 2 MB each). WebP would be about 17× smaller with no visible difference, which matters for phones over ngrok. Not done yet.
15. **The per-minute edit limit is in memory.** It resets on restart; the daily limit doesn't.

### Accuracy and data quality

16. **Cost figures are placeholders** (every value is marked `VERIFY`). They're New York guesses, applied unchanged to every city.
17. **Building heights outside New York are often guesses** (10 m default), because many cities don't tag heights in OSM. This affects the guides and AI ideas.
18. **Street widths are estimates** (tag → building gap → lane count).
19. **Divided roads:** each carriageway is a separate pickable street, and the detection heuristic can miss or misfire.
20. **Complaint data exists only for New York.** Elsewhere the AI suggests from the street layout.
21. **Zone data never refreshes.** It's deliberately cached forever, so ids stay stable.

### Reliability and performance

22. **The public Overpass servers are slow and flaky.** Opening a new area takes 5–40 s the first time and sometimes fails.
23. **Caches grow without limit:** `server/data/zones/`, `server/cache/tiles/`, `server/cache/ai/`.
24. **Everything depends on one laptop.** If it's asleep or offline, phones can't reach the server, and photo-real edits and models can't be served.

### Product and UI gaps

25. **The admin panel isn't a separate build.** It's the Expo app in a browser on the dev server.
26. **"Request a change" on the desktop home** only shows a hint ("click a zone"). It doesn't start a request directly.
27. **Draft thumbnails** are only captured from the 3D-model tab.
28. **Leftovers from the pilot:** the `/city` endpoint, `scene/city.ts` and the NYC import scripts.
29. **No continuous integration:** tests only run locally.
30. **Accessibility** has basic labels and roles, but hasn't been checked with a screen reader.

---

## 23. Suggested next steps

1. **Add the ngrok token and run `npm start`**, then test phone submission → laptop Gemini processing → saved phone preview. Then test sign-in, voting, decisions, petitions and the leaderboard with two accounts.
2. **Test laptop-offline submissions and recovery.** Optionally configure ngrok for interactive previews, and verify a second device cannot use admin AI tools or decide requests.
3. **Smoother walking between viewpoints:** project the nearest viewpoint's edits onto the 3D model for the spots in between. That would allow Google's normal ~10 m steps at no extra cost. Also, start preparing when a draft is first rendered.
4. **Smaller edits:** save them as WebP.
5. **Verify the implemented processing indicators and admin retry controls** against the live cloud queue.
6. **Test the implemented phone app on an older physical phone**, especially maps, sign-in and saved previews.
7. **Sourced unit costs**, with per-city or per-country factors.
8. **CI** (GitHub Actions running `npm test` and the typechecks) and a licence.
9. **Hosting** for the server and panel, so they don't depend on one laptop.
10. **Rotate all keys** before anything public.
