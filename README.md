# Mamdani AI

**Cloud request integration:** [Setup, offline behavior and measured usage limits](docs/CLOUD_REQUESTS.md). Phones now submit through Supabase; the laptop processes queued requests and uploads saved previews.

**Full guide and list of known issues:** [docs/PROJECT.md](docs/PROJECT.md)

A real Google map of the whole world, tilted with Google's 3D buildings and split into 200 m zones. Zoom in anywhere and the zone squares appear; tap one to open it. Its streets, buildings and parks are loaded from OpenStreetMap the first time anyone opens it. You can pan, zoom, rotate and tilt, search streets and places, and jump to your location. Zones with requests are tinted orange (waiting) or green (approved) with a count. Tap a zone to see a description of the area and its requested changes. Residents **confirm or deny** each request and a city admin makes the final **approve / reject** call. Open a request to see it in **Google Street View with the change built into the real photos** (Gemini photo-real edits, prepared as soon as the request is submitted): switch between Before, After and a Compare slider, look around and walk up and down the street. Or view the change as a 3D model on its own. Every request comes with a cost estimate; petitions and a points leaderboard sit on top. The app uses a light, Google Maps-style look. Phones get a bottom tab bar; screens 1024 px and wider get a top bar and side panels.

**People decide what changes.** Claude can suggest ideas based on an area's complaints, but every suggestion opens as an editable draft labelled "AI suggested", and nothing is submitted until a person confirms it. Costs always come from a fixed unit-cost table, never from the AI.

**Two apps, one worker.** The laptop runs the city admin panel and the background processing server. With Supabase configured, the phone saves drafts and requests directly in the cloud; the laptop picks up jobs, prepares Gemini views and uploads saved JPEG previews. Phones can close the app after submission, and saved results stay available while the laptop is offline. Ngrok is optional for live interactive previews and local-only mode. See [cloud setup](docs/CLOUD_REQUESTS.md).

```
Phone app ──▶ Supabase (drafts, requests, jobs, votes, saved previews) ◀──▶ Laptop worker
                      │                                                  ├─ validates and prices changes
                      └─▶ Phone's saved before/after images               ├─ builds 3D scenes
                                                                         └─ calls Gemini and uploads results
```

| Folder | What's in it |
|---|---|
| `server/` | Fastify API, OpenStreetMap zone loader, NYC 311 data, scene builder, render queue, cost engine, Claude suggestions, Street View page (`public/streetview.html`) |
| `adminpanel/` | The city admin panel: Expo (SDK 57) app run in a browser on the server computer |
| `phone/` | The residents' phone app (Expo SDK 57, iOS and Android): map, zones, new requests, Street View before/after, Feed, petitions with snapshots, ranks, settings. No admin or AI features |
| `shared/` | Change-op schemas (zod), shared types, geo helpers |
| `supabase/` | `setup.sql` (the whole database in one file to import), the migrations it's built from, and a step-by-step [README](supabase/README.md) |
| `scripts/start.sh` | Starts the server and ngrok, and prints the URLs |

## Run it

Needs Node 22 (installed with nvm: run `. ~/.nvm/nvm.sh` in new shells if `node` isn't found).

```bash
npm install
./scripts/start.sh                      # server on :3000, plus ngrok if it's installed
```

- **Admin panel:** `npm run web -w adminpanel`, then open http://localhost:8082 **on the server computer**.
- **Phone app (requests only):** put the public Supabase settings in `phone/.env`, apply the [cloud upgrade](docs/CLOUD_REQUESTS.md), then run `npm start -w phone` and scan the QR code with Expo Go. `EXPO_PUBLIC_SERVER_URL` is optional for interactive previews; it is required in local-only mode.

With no Supabase or Anthropic keys set, everything runs in **local-only mode**: the map, zone panels, requesting changes, costs, 3D views, confirm/deny and approve/reject all work, stored on the PC. You are the only user and also the admin, so you can test the whole loop yourself. Petitions, sign-in and the leaderboard switch on once Supabase is connected.

## Connect the optional services

**Supabase** (shared data, sign-in, 3D model storage): follow [supabase/README.md](supabase/README.md). In short: paste `supabase/setup.sql` into the SQL editor, make sure Email sign-in is on, put the keys in `server/.env` and `adminpanel/.env`, and make yourself an admin.

**AI suggestions (admins only):** set `ANTHROPIC_API_KEY` in `server/.env`. This uses `claude-opus-5-5` with structured output. The model can only refer to street and building IDs in the area; the server turns those into geometry and prices them.

**ngrok (optional):** install it, then run `ngrok config add-authtoken <token>` once. `npm start` then opens the tunnel and writes its URL to `phone/.env`.

**Google Maps** (needed for the browser map, place search and Street View; phones in Expo Go show Google Maps on Android and Apple Maps on iPhone without it):
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and turn on billing.
2. Enable **Maps JavaScript API** (which includes Street View) and **Places API (New)**. (For App Store / Play Store builds later, also **Maps SDK for Android** and **Maps SDK for iOS**.)
3. Credentials → Create API key. Restrict it to those APIs, and add website restrictions for every address the app and server are opened from: `http://localhost:8082/*` (the app), `http://localhost:3000/*` (the Street View page, served by the PC server), plus the ngrok URL or `http://<this computer's IP>:3000/*` for phones.
4. Optional but recommended: Map Management → Create Map ID (JavaScript, **Vector**, tilt and rotation on). Without one the app uses Google's `DEMO_MAP_ID`.
5. Put them in `adminpanel/.env` as `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=` and `EXPO_PUBLIC_GOOGLE_MAP_ID=`, then restart `npx expo start`.

Place search on phones calls Places API directly, so a key with website restrictions won't work there; use a second key restricted to your app's bundle IDs for phone builds.

## Zones anywhere in the world

- Zones are a fixed worldwide grid (`shared/src/zones.ts`): every point on Earth has one ~200 m zone id such as `g72680_44814`, computed the same way by the app and the server.
- The first time a zone is opened, the server fetches it and its 8 neighbours from OpenStreetMap (Overpass API) and caches them in `server/data/zones/`. This takes 5–40 s, depending on how busy the free Overpass servers are; after that it's instant. If Overpass is down, the app asks you to try again in a minute.
- Building heights come from OpenStreetMap's `height` or `building:levels` tags. New York has real heights; many cities don't, and those buildings default to about 10 m.
- Complaint counts come from New York City's open 311 data, fetched live for zones in NYC. Other cities show building and street counts instead.
- The older lower-Manhattan pilot zones (`r09c14` ids) still work for requests made before zones went worldwide.

## How Street View before/after works

- `server/public/streetview.html` shows Google's panorama nearest the change, facing it. The browser app shows it in an iframe and phones in a WebView. Where Google has no Street View, the app falls back to the 3D model.
- **Photo-real edits.** At each spot, the request's 3D model is rendered as a placement guide for up to four directions. The server fetches the same Street View images and has Gemini (`gemini-3.1-flash-image` on Vertex AI) build only the changes visible in each one. Only what actually changed is kept (the rest stays Google's sharp photo), and the edits are wrapped around you, so looking around is instant and free. Walking to the next spot loads or builds that one.
- **Viewpoints prepared on submit.** A hidden Chrome on the server opens each new request and edits viewpoints ~25 m apart around the change, inside its zone, up to 15 edits (~$0.50–1.50, about a minute). You open on a viewpoint and can walk anywhere in the zone: viewpoints show their saved edits (downloaded ahead), and spots in between show the 3D model of the change, so nothing is made or spent while you walk.
- **Stay in the zone.** Street View won't let you walk out of the request's zone; past the edge it takes you back.
- **Loading screen.** Street View stays covered until the photo-real view is ready, with a bar showing progress and about how many seconds are left (a fresh spot takes ~20–25 s). It's revealed already facing what changed, with a marker on it.
- **Who can make edits.** Only the admin panel on the server computer (and the prepare step). Phones only see prepared spots.
- **Setup** in `server/.env`: `VERTEX_API_KEY` and `VERTEX_PROJECT` (or `server/vertex-key.json`), and `GOOGLE_MAPS_SERVER_KEY` (Street View Static API, no website restriction). Each edit costs ~3–10¢; preparing a request ~$0.50–1.50, once.
- **Heads-up:** editing Street View images goes against the Google Maps Platform terms (section 3.2.3(c)). Google could suspend the Maps key. This was a deliberate choice for this project.

Full details, render times and costs: [docs/PROJECT.md §11–12](docs/PROJECT.md#11-photo-real-views-gemini-on-vertex-ai).

## How the 3D model works

- The 3D model shows **only that request's changes**: changed streets with their new lanes, new buildings, parks, trees and crosswalks. Unchanged streets are flat grey ribbons and existing buildings are flat grey footprints, just for orientation.
- Each render is exported at 3 levels of detail; the phone loads the lowest first and sharpens as you zoom in.
- Renders are cached by a hash of the zone and its changes. While you build a request, every edit queues a render in the background (edits are grouped for 500 ms, and a newer edit replaces an older one that hasn't started), so the render is usually ready by the time you submit.

## Before a demo

- **Cost numbers are placeholders.** `server/src/cost/unitCosts.ts` holds order-of-magnitude NYC figures, each marked `VERIFY`. Check them against NYC DOT, Parks and HPD sources before presenting them as real. Zones outside New York are priced with the same NYC numbers for now.
- Refresh 311 data with `npm run import:issues --workspace server`. The server also refreshes it every hour while running.

## Tests

```bash
npm test          # 91 tests: schemas, zone grid, OpenStreetMap parsing, geometry, costs, render queue, HTTP API and admin rules, photo-real (faked), and the Supabase SQL (run in PGlite)
npm run typecheck
cd adminpanel && npx expo-doctor
```
