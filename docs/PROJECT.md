# CivicSim (Mamdani AI): project guide and known issues

Status as of **10 October 2026**. This document explains what the project is, how every part works, how to run it, and everything that is currently broken, unfinished or risky. The quick-start lives in the [README](../README.md); this is the full picture.

---

## Contents

1. [What it is](#1-what-it-is)
2. [How people use it](#2-how-people-use-it)
3. [Architecture](#3-architecture)
4. [Repository layout](#4-repository-layout)
5. [Zones: the worldwide grid](#5-zones-the-worldwide-grid)
6. [Map data: OpenStreetMap and NYC 311](#6-map-data-openstreetmap-and-nyc-311)
7. [Changes (change ops)](#7-changes-change-ops)
8. [3D scene building and the render queue](#8-3d-scene-building-and-the-render-queue)
9. [Street View before/after](#9-street-view-beforeafter)
10. [Photo-real renders with Gemini](#10-photo-real-renders-with-gemini)
11. [Cost estimates](#11-cost-estimates)
12. [AI suggestions (Claude)](#12-ai-suggestions-claude)
13. [Voting, decisions, petitions, points](#13-voting-decisions-petitions-points)
14. [The app (Expo)](#14-the-app-expo)
15. [Server API](#15-server-api)
16. [Configuration and keys](#16-configuration-and-keys)
17. [Running it](#17-running-it)
18. [Tests](#18-tests)
19. [Costs of running it](#19-costs-of-running-it)
20. [Current issues](#20-current-issues)
21. [Suggested next steps](#21-suggested-next-steps)

---

## 1. What it is

An app where residents propose physical changes to their city and see what those changes would really look like before anything is built. Examples include a protected bike lane, a bus lane, street trees, a park, a wider sidewalk, a crosswalk, or replacing a low building with affordable housing.

- **Anywhere in the world.** The map is split into ~200 m zones. Any zone can be opened, and its streets and buildings are loaded from OpenStreetMap on demand.
- **People decide.** Claude can *suggest* ideas based on a zone's problems, but every idea opens as an editable draft labelled "AI suggested", and nothing is submitted until a person confirms it.
- **See it before it happens.** Each request can be viewed in Google Street View, with the change drawn into the real street:
  - realistic 3D, live as you look around;
  - optionally, photo-real images redrawn by Gemini.
- **Honest numbers.** Every request has a cost estimate computed from a fixed unit-cost table, never invented by AI. (The table is still placeholder figures; see [issues](#20-current-issues).)
- **Civic process.**
  - Residents confirm or deny requests.
  - A city admin approves or rejects them.
  - Requests can become petitions.
  - Participation earns points and ranks on a leaderboard.

---

## 2. How people use it

1. **Find a place.**
   - Search a street or place (Google Places), or pan the map.
   - Zoom in and the zone squares appear.
   - Zones with requests are tinted: orange = waiting, green = approved, with a count badge.
2. **Open a zone** by tapping a square. The zone panel shows:
   - a plain-language description (streets, buildings, building heights);
   - for New York only, the last 90 days of 311 complaints;
   - the requests made there, most-confirmed first;
   - directions to the zone, which open Google Maps or Apple Maps.
3. **Request a change** by picking one or more changes:
   - **Bike lane, bus lane, sidewalk, no parking:** tap a street.
   - **Rebuild lot:** tap a building.
   - **Park:** draw an area.
   - **Trees:** draw a line or an area.
   - **Crosswalk:** tap a spot.

   The cost updates live, and a 3D preview renders in the background.
4. **Submit.** The request is now public.
5. **Others review it.**
   - They open it and see it in Street View (Before / Compare slider / After) or as a 3D model.
   - They tap **Confirm** or **Deny**.
   - An admin makes the final **Approve / Reject** call.
6. **Petitions and points.** A request's author can start a petition, and people sign it. Points flow to the leaderboard. (These features need Supabase connected.)

---

## 3. Architecture

```
 Phone / browser app (Expo: iOS, Android, web)
        │  HTTPS (LAN IP, or ngrok when away from home)
        ▼
 PC server (Fastify, Node 22) ─────────────┐
   ├─ zone loader: OpenStreetMap (Overpass) │  cache: server/data/zones/*.json
   ├─ NYC 311 complaints (Socrata, live)    │
   ├─ scene builder → .glb at 3 detail levels│  cache: server/cache/tiles/
   ├─ render queue (SQLite-backed)          │
   ├─ cost engine (fixed unit costs)        │
   ├─ Claude suggestions (optional)         │
   ├─ Street View page (/streetview)        │
   ├─ Gemini photo-real renders (optional)  │  cache: server/cache/ai/
   └─ drafts + local-only data (SQLite)     │  server/data/server.sqlite
        │ on confirm (when connected)
        ▼
 Supabase: proposals, votes, petitions, points, auth, render storage
```

- **The PC does the heavy work:** fetching map data, building 3D scenes, rendering and queueing. The phone only displays things.
- **Drafts stay on the PC** until a person confirms them. In **local-only mode** (no Supabase), submitted requests, votes and decisions are also stored on the PC. You are the only user, and also the admin, so the whole loop can be tested alone.
- **Google:**
  - The map (Maps JavaScript API on web, react-native-maps on phones).
  - Place search (Places API, New).
  - Street View (Maps JavaScript API).
  - Street View images for Gemini (Street View Static API).

---

## 4. Repository layout

| Path | What's in it |
|---|---|
| `shared/src/` | Shared by app and server: change-op schemas (zod), domain types, geo helpers, **the worldwide zone grid** (`zones.ts`) |
| `server/src/app.ts` | All HTTP routes |
| `server/src/data/osm.ts` | OpenStreetMap zone loader: Overpass query, parsing, street merging, width measurement, cache |
| `server/src/data/zoneIssues.ts` | Live NYC 311 complaint counts per zone |
| `server/src/data/importNyc.ts`, `importIssues.ts`, `socrata.ts`, `tiles.ts` | The original lower-Manhattan pilot import (NYC Open Data) and the tile loader that serves both pilot and worldwide zones |
| `server/src/scene/` | Scene builder (`build.ts`), geometry (`geometry.ts`), materials (`palette.ts`), GLB export, render cache (`render.ts`) |
| `server/src/queue/renderQueue.ts` | Background render queue |
| `server/src/cost/` | Unit-cost table and estimator |
| `server/src/suggest/` | Claude suggestions |
| `server/src/ai/streetRender.ts` | Gemini photo-real Street View renders |
| `server/public/streetview.html` | The Street View before/after page (three.js + Google Street View) |
| `server/public/preview.html` | Desktop debug viewer for render files |
| `server/src/db.ts`, `supabase.ts` | Local SQLite store; Supabase client |
| `supabase/migrations/` | Postgres schema, row-level security, points triggers, leaderboard view |
| `mobile/src/app/` | Screens (Expo Router) |
| `mobile/src/components/` | Map, picker map, change builder, Street View, 3D viewer, UI kit |
| `mobile/src/lib/` | API client, data access, zones, places, directions, theme |
| `scripts/start.sh` | Starts the server (and ngrok if installed) |

Size: about 10,000 lines of TypeScript, TSX and HTML.

---

## 5. Zones: the worldwide grid

File: `shared/src/zones.ts`. Used identically by the app and the server.

- **Shape.** Every point on Earth falls in exactly one ~200 m × 200 m zone.
- **Rows** are bands of equal latitude, 200 m tall.
- **Columns** are 200 m wide, measured at the middle of the 1° latitude band the row sits in. Column lines therefore run straight within each band (~111 km) instead of shifting row to row like bricks.
- **Ids** look like `g72680_44813` (`g{row}_{col}`). Neither side needs an import step or a lookup table to agree on ids.
- **Helpers:**
  - `zoneIdAt(lng, lat)`
  - `zoneBbox(id)`
  - `zoneBlock(id)`: the zone plus its 8 neighbours
  - `zonesInView(bbox)`: draws the grid; it returns nothing for views too large to draw.
- **Map behaviour.** The grid is drawn from zoom 15.5 upward (`GRID_ZOOM`). Zoomed out, only zones with requests are drawn.
- **Labels.** A zone is shown by its centre coordinates, e.g. "40.7262°N 73.9971°W", plus a name built from its two longest streets.
- **Pilot zones.** The earlier **lower-Manhattan pilot zones** (`r09c14` ids, from NYC Open Data) still work for requests made before the grid went worldwide. They are a separate grid and are only drawn when they have requests.

---

## 6. Map data: OpenStreetMap and NYC 311

### OpenStreetMap (all zones)

`server/src/data/osm.ts`.

**Fetching and caching**
- The first time a zone is opened, the server sends **one Overpass query** for the zone *and its 8 neighbours*. It asks for buildings, roads (trunk to living street), parks and gardens.
- Each zone is cached as `server/data/zones/{id}.json`.
- Zones already on disk are never overwritten, so the street and building ids that requests refer to never shift.
- Two Overpass mirrors are tried, 3 rounds each, with back-off.

**Buildings**
- Height comes from the `height` tag, else `building:levels × 3.2 + 1`, else 6 m for houses and sheds, else **10 m**.
- Each building belongs to the zone containing its centre.

**Streets**
- Clipped at zone edges.
- **Merged** when pieces of the same name continue end-to-start in roughly the same direction (within 45°). This turns OSM's many fragments into pickable streets without creating hairpins.
- Travel lanes come from `lanes`, else a default per road class.
- Parking comes from the `parking:*` tags, else 2 sides (0 for trunk roads and living streets).
- Bike lanes come from the `cycleway*` tags.
- **Width:**
  - Uses the `width` tag when mapped.
  - Otherwise it's *measured from the gap between the buildings on each side*, at three points along the street, minus two sidewalks. The result is capped so an open square doesn't count as road.
  - **Divided roads** (a one-way with a same-named twin running alongside in the opposite direction) are treated as one carriageway each, with no parking unless tagged.

**Parks** are clipped to each zone.

### NYC 311 complaints (New York zones only)

`server/src/data/zoneIssues.ts`.

- Zones inside New York City get **live counts** of the last 90 days of 311 complaints, from Socrata dataset `erm2-nwe9`. Counts are grouped into categories (street condition, noise, heat/hot water, sanitation, traffic safety, parking, trees/parks, housing condition, homelessness, other) and cached for an hour.
- Zones elsewhere get **no complaint data**. The app says so and shows building and street counts instead.

---

## 7. Changes (change ops)

Every change is a typed **change op** (`shared/src/changeOps.ts`), validated with zod on both the app and the server. The AI suggests changes in the same format.

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

A **draft** is `{ areaId, title, description, ops[], source: 'human' | 'ai_suggested' }`. The server checks that every op refers to streets and buildings that exist in the zone, and that its geometry stays inside the zone (with ~50 m of slack).

---

## 8. 3D scene building and the render queue

**Scene builder** (`server/src/scene/build.ts`). It turns a zone into geometry:
- **Two styles:**
  - `full`: the whole street scene.
  - `changes`: what the app uses. Only the change in colour, over grey context.
- **What gets drawn:**
  - Buildings are extruded footprints.
  - Streets are ribbons with a lane cross-section.
  - Changes are applied on top: lanes with edge lines and a hatched buffer, posts, red bus lanes, a new building, park ground, trees, crosswalk stripes, a wider sidewalk.
  - Neighbouring zones' buildings are added as grey context.
- **Props.** It also emits **props**: exact positions of posts, trees and lane symbols. The Street View page uses them to place detailed models.
- **Determinism.** The output is deterministic, using seeded random numbers, so the same request always produces identical geometry.

**Export.** Files are glTF binary (`.glb`) at **3 levels of detail** (lod0 = highest), with quantised geometry (no Draco or meshopt, because the phone's JS engine has no WASM). They're stored at `server/cache/tiles/{zone}/{hash}/lod{0,1,2}.glb`.

**Hash.** Combines the scene version, style, zone, the zone's data timestamp and the ops. Files are immutable and cached forever by browsers.

**Render queue** (`server/src/queue/renderQueue.ts`):
- In-process queue (2 at a time), persisted in SQLite so jobs resume after a restart.
- Draft edits are grouped for 500 ms, and a newer edit replaces an older one that hasn't started.
- Identical scenes render once.
- Progress is pushed to the app over a WebSocket (`/ws`): queued → building → lod ready → done.
- The result: by the time someone taps Submit, the render is usually ready.

---

## 9. Street View before/after

`server/public/streetview.html`. The browser app shows it in an iframe and phones in a WebView, so there's one implementation for both.

**Finding the view**
- Asks Google for the panorama nearest the change, preferring Google's own outdoor car photos.
- Faces the change, or looks down the street for street changes.
- Tilts up and widens the view for new buildings.

**The overlay**
- three.js draws the request's model in transparent layers over the panorama. The camera follows the panorama's position, heading, pitch and zoom (zoom 1 = 90° across).
- The camera height is assumed to be 2.5 m.
- You can drag to look around and tap the street to walk, and the model stays in place.

**Realism**
- **Existing buildings** are drawn invisibly into the depth buffer, so new things behind them are hidden.
- **Road paint** (bike lanes, bus lanes, lines, symbols, new grass) is on a separate canvas blended with CSS *hard-light*. The photo's asphalt texture and traffic show through, and paint has worn patches.
- **Solid objects:**
  - Flexible posts with reflective bands.
  - Trees with trunks, limbs and leaf-cluster canopies, plus soil pits.
  - New buildings with stone storeys, framed reflective windows and a shopfront.
  - Concrete sidewalks with joints.
- **Shadows.** New objects cast shadows onto the real street. The sun is placed for that latitude and the month the photo was taken, at mid-afternoon.

**Controls**
- **Before / Compare / After.** Compare is a draggable slider.
- **Fallback.** If there's no Street View, the app switches to the plain **3D model** tab.
- **Debug.** `?debug=1` shows existing buildings as wireframes, to check alignment.

**Keys.** The page gets its Maps key from the server (`GOOGLE_MAPS_BROWSER_KEY`), written into the page. It is never in a URL, and request logs show `key=[hidden]`.

---

## 10. Photo-real renders with Gemini

`server/src/ai/streetRender.ts`, plus the "photo-real" section of `streetview.html`.

**How it works**
1. When you stop moving for ~1 second (in After or Compare mode), the page renders the model from the exact camera on black. This is the *placement guide*.
2. The page sends the guide to `POST /ai/render`.
3. The server fetches the **same Street View image** (Street View Static API, up to 640 px).
4. The server sends Gemini (`gemini-nano-banana-2.1` by default, via the Interactions API) three things: a prompt, the photo and the guide. The prompt asks for the change to be **physically built**, for example a raised concrete kerb island with planters, parked cars removed, or a real new building. It also asks for everything else in the photo to stay unchanged.
5. The result is saved to `server/cache/ai/` and fades in over the live view. It fades out the moment you move.
6. Going back to a rendered view is free.

**Safeguards**
- Both paid keys stay on the server and never reach the browser.
- Renders are only accepted from the server's own Street View page (same-origin check).
- At most **20 new renders a minute** and **`AI_DAILY_LIMIT` (default 100) a day**.
- Identical requests are merged into one.
- A **"Photo-real" button** turns rendering off. It shows "not set up" when the keys are missing.

> **Terms-of-service warning.** Editing Street View images goes against the Google Maps Platform terms, section 3.2.3(c): "Customer will not create content based on Google Maps Content." Google could suspend the Maps key or project. This was a deliberate choice by the project owner.

---

## 11. Cost estimates

`server/src/cost/estimate.ts` and `unitCosts.ts`.

- Quantities are measured from the geometry: lane length per side, park area, number of trees, new floor area, sidewalk area, kerb length.
- Each quantity is multiplied by a unit cost, then 20% contingency is added. The range shown is −30% to +50% of the total.
- The same function prices AI suggestions, so the AI never invents a cost.

**All unit costs are placeholders marked `VERIFY`**, e.g. protected bike lane $1.5M per mile per side, street tree $3,500, affordable unit $600k, park $250/sq ft. They are New York-scale guesses, and they are used for every city. See [issues](#20-current-issues).

---

## 12. AI suggestions (Claude)

`server/src/suggest/claude.ts`. Optional; needs `ANTHROPIC_API_KEY`.

- "Get AI ideas for this zone" sends Claude (`claude-opus-5-5`, structured output, medium effort) a compact summary of the zone:
  - streets, with ids, lengths, widths, lanes and existing bike lanes;
  - low buildings that could be redeveloped;
  - complaint counts.
- Claude returns 1–3 ideas with rationales, using only ids from the summary. The server converts them into change ops, drops anything that doesn't fit the zone, and prices them.
- Ideas appear as cards. "Review and edit this idea" opens a normal draft labelled AI suggested. Nothing is submitted automatically.

---

## 13. Voting, decisions, petitions, points

Supabase schema: `supabase/migrations/20260929000000_init.sql`.

**Tables**
- `profiles`: username, points, rank, role (resident / admin).
- `areas`, `area_issues`.
- `proposals`: ops, cost, status, render URLs, and confirm/deny counts.
- `proposal_votes`.
- `petitions`, `petition_signatures`.
- `point_events`.
- A `leaderboard` view.

**Statuses**
- Requests: `submitted` → `under_review` → `accepted` / `rejected`. Only admins change status.
- Petitions: `open` / `goal_reached` / `closed`, with a goal between 10 and 100,000.

**Points**, applied by triggers:

| Event | Points |
|---|---|
| Submitting a request | +10 |
| Receiving a confirm vote | +2 |
| Signing a petition | +1 |
| Your petition reaching its goal | +50 |
| Your request accepted by the city | +100 |

**Ranks:** Resident (0), Advocate (50), Organizer (200), Council Voice (750).

**Row-level security:** public rows are readable by all, and users can only write their own votes and signatures.

**Local-only mode:** requests, votes and decisions are stored on the PC instead. Petitions, sign-in and the leaderboard need Supabase.

---

## 14. The app (Expo)

Expo SDK 57, React Native 0.86, React 19.2, Expo Router. One codebase for iOS, Android and web.

| Screen | File | What it does |
|---|---|---|
| Map | `app/(tabs)/index.tsx` | Google map, zone grid when zoomed in, tinted request zones, search, my-location / 2D-3D / north buttons, "zones with requests" list (side panel on wide screens) |
| Zone | `app/area/[id].tsx` | Description, complaints or building/street counts, requests with Confirm/Deny, AI ideas, drafts, directions, "Request a change" |
| New request | `app/draft/[id].tsx` | Change builder with a real-map picker (tap streets or buildings, draw areas), live cost, background preview, submit |
| Request | `app/proposal/[id].tsx` | Street View before/after (or 3D model), description, cost, Confirm/Deny, admin decision, petition |
| Requests | `app/(tabs)/proposals.tsx` | All requests |
| Petitions | `app/(tabs)/petitions.tsx` | Petitions (Supabase) |
| Ranks | `app/(tabs)/leaderboard.tsx` | Leaderboard (Supabase) |
| Account | `app/(tabs)/account.tsx` | Sign-in with an emailed code (Supabase); dev mode notice |

**Design.** A light, Google Maps-like look: white panels, blue `#1A73E8`, Roboto. Zone states are orange (waiting), green (approved) and blue (selected). Phones get a bottom tab bar; screens 1024 px and wider get a top bar and side panels.

**Platform differences:**

| | Web | Phones |
|---|---|---|
| Map | `@vis.gl/react-google-maps` (vector map, tilt, 3D buildings) | `react-native-maps` (Apple Maps on iOS / Google Maps on Android in Expo Go) |
| Street View | iframe | WebView |
| 3D model | `@react-three/fiber` on WebGL | expo-gl |

---

## 15. Server API

| Method and path | Purpose |
|---|---|
| `GET /health` | Mode (local-only / Supabase), whether suggestions are on, zone count, queue length |
| `GET /areas` | Every zone the server knows (pilot + worldwide zones opened so far) |
| `GET /areas/:id` | Zone detail: description data, issues and source, before-render, pickable streets and buildings. Fetches the zone from OSM the first time. |
| `POST /estimate` | Price a list of ops for a zone |
| `GET/POST /drafts`, `GET/PATCH/DELETE /drafts/:id` | Your drafts. Edits queue a render. |
| `POST /drafts/:id/confirm` | Submit. Renders if needed, then stores in Supabase or locally. |
| `GET /local/proposals`, `POST /local/proposals/:id/vote`, `POST /local/proposals/:id/status` | Local-only mode requests, votes and admin decisions |
| `POST /areas/:id/suggest` | Claude ideas (503 if not configured) |
| `GET /streetview` | The Street View before/after page |
| `GET /ai/status`, `POST /ai/render` | Photo-real renders (same-origin only, limited) |
| `GET /tiles/...`, `GET /ai/...` | Render files and photo-real images (immutable, long cache) |
| `GET /ws` | Live render progress |
| `GET /city`, `GET /preview` | Old pilot city map; debug viewer |

**Auth:**
- With Supabase, routes that write need `Authorization: Bearer <Supabase access token>`.
- In local-only mode the token (or `x-dev-user`) is taken as the user id, and defaults to `dev-user`.

---

## 16. Configuration and keys

Real values go in `.env` files, which git ignores. The `.env.example` files list every setting.

**`mobile/.env`**

| Setting | Purpose |
|---|---|
| `EXPO_PUBLIC_SERVER_URL` | The PC server: LAN IP or ngrok URL. The browser app uses `localhost` automatically. |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase (optional) |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser map and Places. **Visible to users by design;** protect it with website restrictions. |
| `EXPO_PUBLIC_GOOGLE_MAP_ID` | Vector map style for tilt and 3D buildings (defaults to `DEMO_MAP_ID`) |

**`server/.env`**

| Setting | Purpose |
|---|---|
| `PORT` | Default 3000 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase. The service key stays on the PC. |
| `ANTHROPIC_API_KEY` | Claude suggestions |
| `NYC_APP_TOKEN` | Higher NYC Open Data limits (optional) |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps key for the Street View page (same as the app's) |
| `GOOGLE_MAPS_SERVER_KEY` | Fetches Street View images for Gemini. Needs Street View Static API and no website restriction. |
| `GEMINI_API_KEY` | Photo-real renders |
| `GEMINI_IMAGE_MODEL` | Default `gemini-nano-banana-2.1` |
| `AI_DAILY_LIMIT` | Default 100 new photo-real renders a day |

**Google Cloud APIs to enable:**
- Maps JavaScript API (map and Street View)
- Places API (New)
- Street View Static API (for Gemini)
- For store builds later: Maps SDK for Android and iOS
- Billing must be on in the project; a Free Trial counts.

---

## 17. Running it

You need Node 22. On the development Mac it's installed with nvm, so run `. ~/.nvm/nvm.sh` in new shells.

```bash
npm install
./scripts/start.sh                    # server on :3000 (and ngrok if installed)
cd mobile && npx expo start --web     # app at http://localhost:8081
```

**Phones:**
1. Set `EXPO_PUBLIC_SERVER_URL` to `http://<this computer's LAN IP>:3000` or the ngrok URL.
2. Run `npx expo start` and open the app in Expo Go.

**Optional pilot data.** `npm run import:nyc --workspace server` imports the original lower-Manhattan pilot (buildings, streets, parks, 311). It's no longer required.

---

## 18. Tests

```bash
npm test            # 63 tests (12 shared + 51 server)
npm run typecheck
cd mobile && npx expo-doctor
```

| Area | What's covered |
|---|---|
| Shared | Op schemas, geo maths, ranks, zone grid (round trips on 5 continents, aligned columns, neighbours, view listing) |
| OSM | Tag parsing, line clipping, splitting into zones, caching (one fetch for 9 zones), street merging (no hairpins), width from buildings |
| Scene | Determinism, lanes and parking, buildings, props (posts, symbols, trees) |
| Costs | Quantities and totals |
| Render queue | Debounce, replacement, caching, resume |
| HTTP API | Zone detail, the full draft → render → confirm → vote → decide loop, validation, Street View page, render endpoint refusing other sites |
| Gemini renders | Prompt asks for physical construction, image parsing, caching, daily limit, missing-key messages (all with fake Google and Gemini, no cost) |
| Supabase | The SQL migration runs and its triggers and leaderboard work (in PGlite) |
| Claude | Area summary and op conversion (mocked) |

The HTTP API tests use the NYC pilot data when it's present, and are skipped when it's not.

---

## 19. Costs of running it

These are rough figures; check Google's current pricing.

**Google Maps.** Each API has a free monthly amount (about 10,000 for most, about 5,000 for dynamic Street View), then:

| Call | Price after the free amount |
|---|---|
| Map load | ~$0.007 |
| Street View panorama | ~$0.014 |
| Street View Static image | ~$0.007 |

**Gemini image render:** about $0.04–0.07 each, roughly 1,500–2,000 tokens. Renders aren't covered by free tiers.

**Free Trial.** The project's Google Cloud Free Trial has $300 of credit (expires 9 January 2027). Nothing is charged to a card unless the account is upgraded.

**Rough usage** with automatic photo-real renders:

| Activity | Cost |
|---|---|
| Looking all the way around one spot | ~$0.20–0.40 |
| Walking one block | ~$2–4 |
| The daily cap (100 renders) | ~$4–7 a day at most |

**Claude suggestions:** a few cents per request (Opus, medium effort).

---

## 20. Current issues

Ordered roughly by importance.

### Risks

1. **Gemini editing Street View breaks Google's terms (3.2.3(c)).** Google may suspend the Maps key or project. A compliant alternative is to run Gemini on users' own photos, or keep only the 3D overlay.
2. **API keys were shared in plain text during development.** All three (two Maps keys and the Gemini key) should be **regenerated**, with new values typed straight into the `.env` files.
3. **The app's Maps key isn't restricted.** It's visible in the browser by design, so it should be limited to the app's websites and to the Maps APIs.
4. **`/ai/render` isn't truly locked down.**
   - The same-origin check stops other websites, but not a script that fakes the `Origin` header.
   - The per-minute and daily limits live in memory and reset when the server restarts.
   - Before the server is reachable from the internet (ngrok), renders should require a signed-in user, and the limits should be stored on disk.
5. **The repository is public** and has no licence file.

### Blocked on accounts and setup

6. **The app's map key belongs to a project without billing.** So the map shows "For development purposes only" and Street View photos appear colour-inverted. The fix is to switch `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_BROWSER_KEY` to a key from the Free Trial project, with website restrictions.
7. **Photo-real renders have never been run for real.**
   - Everything up to Google's servers is tested, using fakes and a run that Google refused because an API wasn't enabled.
   - The Gemini Interactions API response format is parsed defensively but hasn't been seen live.
   - Render quality, speed and accuracy (does Gemini respect the guide? does it change other things?) are unknown.
8. **Supabase isn't connected.** Sign-in, petitions, the leaderboard, real multi-user voting and uploading renders to storage haven't been run against a real project. Only the SQL migration is tested (in PGlite).
9. **ngrok isn't set up.** Phones only work on the same Wi-Fi, and the Mac's LAN IP changes between networks. `EXPO_PUBLIC_SERVER_URL` must be updated when it does.
10. **The app has never been run on a real phone.** It typechecks, bundles for iOS and Android, and passes `expo-doctor`. But these are untested on a device:
    - the phone map (react-native-maps);
    - the Street View WebView;
    - the expo-gl 3D viewer;
    - location;
    - Places search on phones, which needs its own key restricted to the app's bundle IDs.
11. **Google's tilted 3D vector map has only been checked in screenshots without WebGL.** Tilt, rotation and 3D buildings on web haven't been seen working.

### Accuracy and data quality

12. **Cost figures are placeholders** (every value is marked `VERIFY`). They're New York guesses, and they're applied unchanged to every city.
13. **Building heights outside New York are often guesses** (10 m default), because many cities don't tag heights in OSM. This affects occlusion (tall real buildings may not hide things behind them) and AI suggestions.
14. **Street widths are estimates** (tag → building gap → lane count). Lanes can land a metre or two away from the real kerb.
15. **Divided roads:**
    - Each carriageway is a separate pickable street.
    - The detection heuristic (an opposite-direction twin within 30 m) can miss or misfire.
    - Pickers can show several streets with the same name.
16. **Street View alignment is approximate:**
    - Camera height is assumed to be 2.5 m.
    - The ground is assumed flat, which breaks on hills.
    - OSM positions are off by ±1–2 m.
    - Some panoramas have a slight tilt that isn't corrected.
17. **Moving things in photos can't hide new objects.** Buses and parked cars appear behind a new building or lane, because the photo has no depth.
18. **The sun is a guess** (mid-afternoon in the photo's month), so new shadows may not match the photo's shadows.
19. **Complaint data exists only for New York.** The AI suggests from the street layout elsewhere.
20. **Zone data never refreshes.** It's cached forever on first fetch, deliberately, so ids stay stable. OSM edits after that aren't picked up.

### Reliability and performance

21. **The public Overpass servers are slow and flaky.** The first open of a new area takes 5–40 s, and sometimes fails ("try again in a minute"). A self-hosted Overpass server or a pre-built extract would fix this.
22. **Caches grow without limit:** `server/data/zones/`, `server/cache/tiles/`, `server/cache/ai/`. Nothing cleans them up.
23. **Automatic photo-real renders can be costly** for people who look around a lot (see [§19](#19-costs-of-running-it)). Planned improvements aren't built yet:
    - a "Render this view" button;
    - free turning by re-projecting renders onto the panorama;
    - wider 120° renders;
    - skipping views where nothing changes;
    - the cheaper Lite model while moving;
    - rendering key views once at submit time.
24. **The Street View page may request the same render twice on load** (an extra camera event). The server merges these, so it's only charged once.
25. **The 360° render mode isn't built** (renders are per view).
26. **Render-queue and AI rate limits are in memory.** They're per server process, and render jobs are persisted, but rate limits aren't.

### Product and UI gaps

27. **"Request a change" on the desktop home** only shows a hint ("click a zone"). It doesn't start a request directly.
28. **Draft thumbnails** are only captured from the 3D-model tab, not from Street View.
29. **There's no production deployment:** the web app runs on the Expo dev server, and the server runs on a personal computer.
30. **Leftovers from the pilot:** the `/city` endpoint, `scene/city.ts` and the NYC import scripts still exist. The pilot's 308 zones are listed by `/areas`, though they're only drawn when they have requests.
31. **No continuous integration:** tests only run locally.
32. **Accessibility** has basic labels and roles, but hasn't been audited with a screen reader.

---

## 21. Suggested next steps

1. Regenerate all keys. Move the app to the billing-enabled Maps key with website restrictions.
2. Decide on Gemini given the terms risk. If keeping it:
   - run one real render to judge quality;
   - add the cost-saving changes in issue 23;
   - require sign-in for renders.
3. Connect Supabase and test sign-in, voting, petitions and the leaderboard with two accounts.
4. Run the app on a real iPhone and Android phone over ngrok.
5. Replace placeholder unit costs with sourced figures, with per-city or per-country factors.
6. Add CI (GitHub Actions running `npm test` and the typechecks) and a licence.
7. Plan hosting for the server and web app, so it doesn't depend on one personal computer.
