# Mamdani AI

**Full guide and list of known issues:** [docs/PROJECT.md](docs/PROJECT.md)

A real Google map of the whole world, tilted with Google's 3D buildings and split into 200 m zones. Zoom in anywhere and the zone squares appear; tap one to open it. Its streets, buildings and parks are loaded from OpenStreetMap the first time anyone opens it. You can pan, zoom, rotate and tilt, search streets and places, and jump to your location. Zones with requests are tinted orange (waiting) or green (approved) with a count. Tap a zone to see a description of the area and its requested changes. Residents **confirm or deny** each request and a city admin makes the final **approve / reject** call. Open a request to see it in **Google Street View with the change drawn into the real street**: switch between Before, After and a Compare slider, and walk up and down the street. Or view the change as a 3D model on its own. Every request comes with a cost estimate; petitions and a points leaderboard sit on top. The app uses a light, Google Maps-style look. Phones get a bottom tab bar; screens 1024 px and wider get a top bar and side panels.

**People decide what changes.** Claude can suggest ideas based on an area's complaints, but every suggestion opens as an editable draft labelled "AI suggested", and nothing is submitted until a person confirms it. Costs always come from a fixed unit-cost table, never from the AI.

```
Phone (Expo app) ──HTTPS──▶ ngrok ──▶ PC server :3000
                                       ├─ builds 3D scenes → .glb at 3 levels of detail
                                       ├─ background render queue (SQLite)
                                       ├─ drafts stay here until confirmed
                                       └─ on confirm ──▶ Supabase (proposals, renders, votes, petitions, points)
```

| Folder | What's in it |
|---|---|
| `server/` | Fastify API, OpenStreetMap zone loader, NYC 311 data, scene builder, render queue, cost engine, Claude suggestions, Street View page (`public/streetview.html`) |
| `mobile/` | Expo (SDK 57) app built with Expo Router: map, 3D viewer, change editor, proposals, petitions, leaderboard |
| `shared/` | Change-op schemas (zod), shared types, geo helpers |
| `supabase/migrations/` | Tables, row-level security, points/rank triggers, leaderboard view, storage bucket |
| `scripts/start.sh` | Starts the server and ngrok, and prints the URL for the phone |

## Run it

Needs Node 22 (installed with nvm: run `. ~/.nvm/nvm.sh` in new shells if `node` isn't found).

```bash
npm install
./scripts/start.sh                      # server on :3000, plus ngrok if it's installed
```

- **In a browser:** `cd mobile && npx expo start --web`, then open http://localhost:8081.
- **Phone:** copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_SERVER_URL` to the ngrok URL. Or, on the same Wi-Fi, use `http://<this computer's IP>:3000`. Then run `cd mobile && npx expo start` and open it in **Expo Go**. Every native module used is included in Expo Go.

With no Supabase or Anthropic keys set, everything runs in **local-only mode**: the map, zone panels, requesting changes, costs, 3D views, confirm/deny and approve/reject all work, stored on the PC. You are the only user and also the admin, so you can test the whole loop yourself. Petitions, sign-in and the leaderboard switch on once Supabase is connected.

## Connect the optional services

**Supabase** (shared data, sign-in, render storage):
1. Create a project, then run `supabase/migrations/20260929000000_init.sql` in its SQL editor (or `supabase db push`).
2. `server/.env`: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service key stays on the PC.
3. `mobile/.env`: set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Sign-in uses an emailed 6-digit code. Under Auth → Email Templates → Magic Link, add `{{ .Token }}` to the email body.
5. To make someone a city admin: `update profiles set role = 'admin' where username = '…';`

**AI suggestions:** set `ANTHROPIC_API_KEY` in `server/.env`. This uses `claude-opus-5-5` with structured output. The model can only refer to street and building IDs in the area; the server turns those into geometry and prices them.

**ngrok:** install it, then run `ngrok config add-authtoken <token>` once.

**Google Maps** (needed for the browser map, place search and Street View; phones in Expo Go show Google Maps on Android and Apple Maps on iPhone without it):
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and turn on billing.
2. Enable **Maps JavaScript API** (which includes Street View) and **Places API (New)**. (For App Store / Play Store builds later, also **Maps SDK for Android** and **Maps SDK for iOS**.)
3. Credentials → Create API key. Restrict it to those APIs, and add website restrictions for every address the app and server are opened from: `http://localhost:8081/*` (the app), `http://localhost:3000/*` (the Street View page, served by the PC server), plus the ngrok URL or `http://<this computer's IP>:3000/*` for phones.
4. Optional but recommended: Map Management → Create Map ID (JavaScript, **Vector**, tilt and rotation on). Without one the app uses Google's `DEMO_MAP_ID`.
5. Put them in `mobile/.env` as `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=` and `EXPO_PUBLIC_GOOGLE_MAP_ID=`, then restart `npx expo start`.

Place search on phones calls Places API directly, so a key with website restrictions won't work there; use a second key restricted to your app's bundle IDs for phone builds.

## Zones anywhere in the world

- Zones are a fixed worldwide grid (`shared/src/zones.ts`): every point on Earth has one ~200 m zone id such as `g72680_44814`, computed the same way by the app and the server.
- The first time a zone is opened, the server fetches it and its 8 neighbours from OpenStreetMap (Overpass API) and caches them in `server/data/zones/`. This takes 5–40 s, depending on how busy the free Overpass servers are; after that it's instant. If Overpass is down, the app asks you to try again in a minute.
- Building heights come from OpenStreetMap's `height` or `building:levels` tags. New York has real heights; many cities don't, and those buildings default to about 10 m.
- Complaint counts come from New York City's open 311 data, fetched live for zones in NYC. Other cities show building and street counts instead.
- The older lower-Manhattan pilot zones (`r09c14` ids) still work for requests made before zones went worldwide.

## How Street View before/after works

- `server/public/streetview.html` shows Google's panorama nearest the change, facing it. The request's 3D model is drawn over it by three.js, with a camera that follows the panorama's position, heading, pitch and zoom. You can walk up and down the street (tap the street or the arrows), and the model stays in place.
- Changes are built to look real, not as coloured shapes:
  - Bike lanes are worn green paint with white edge lines, bike symbols with arrows, a hatched buffer, and white flexible posts with reflective bands on black bases.
  - Bus lanes are red with "BUS ONLY" lettering.
  - Trees have trunks, limbs, leafy canopies and soil pits.
  - New buildings have stone storeys, framed glass windows that reflect, and a shopfront.
  - Widened sidewalks are concrete slabs.
  - New objects cast shadows onto the real street, with the sun placed for that latitude and the month the photo was taken.
- Road paint is blended into the photo (CSS hard-light), so the asphalt texture and traffic show through it. Existing buildings are drawn invisibly into the depth buffer, so new things behind them are hidden.
- The server's render says where every post, tree and lane symbol stands (`props` in the model file). The page builds detailed models there, so they stay in place as you walk around.
- Street widths come from OpenStreetMap's `width` tag when it's mapped. Otherwise they're measured from the gap between the buildings on each side of the street. One side of a divided road is treated as its own carriageway.
- Limits: moving things in the photo (buses, parked cars) can't hide a new building in front of them, because the photo has no depth. Models line up to within a metre or two, depending on how accurate OpenStreetMap is. Google's terms don't allow AI-editing the Street View photos themselves, so the realism comes from the 3D, not from editing the image.
- The browser app shows the page in an iframe and phones in a WebView. Where Google has no Street View, the app falls back to the 3D model.

## Photo-real views (Gemini)

When you stop moving in Street View for about a second, the page renders the request's 3D model from the exact camera you're looking through (the *guide*). The server fetches that same Street View image (Street View Static API) and asks Gemini's image model (`gemini-nano-banana-2.1` by default) to redraw the photo with the change **physically built**: kerb-protected lanes with planters, the road narrowed, parked cars gone, a real new building. The result fades in over the live view and fades out as soon as you move. Before / Compare / After work on it too. Renders are cached by view in `server/cache/ai/`, so going back to a view is free. There's a limit of 20 new renders a minute, and a "Photo-real" button turns it off.

Setup in `server/.env`: `GEMINI_API_KEY` (from [Google AI Studio](https://aistudio.google.com/apikey)) and `GOOGLE_MAPS_SERVER_KEY`. That's a Maps key with the **Street View Static API** enabled and no website restriction. Each render costs a few cents on your Gemini key, plus one Street View Static request.

**Heads-up:** editing Street View images goes against the Google Maps Platform terms (section 3.2.3(c), "No Creating Content From Google Maps Content"). Google could suspend the Maps key. This was a deliberate choice for this project.

## How the 3D model works

- The 3D model shows **only that request's changes**: changed streets with their new lanes, new buildings, parks, trees and crosswalks. Unchanged streets are flat grey ribbons and existing buildings are flat grey footprints, just for orientation.
- Each render is exported at 3 levels of detail; the phone loads the lowest first and sharpens as you zoom in.
- Renders are cached by a hash of the zone and its changes. While you build a request, every edit queues a render in the background (edits are grouped for 500 ms, and a newer edit replaces an older one that hasn't started), so the render is usually ready by the time you submit.

## Before a demo

- **Cost numbers are placeholders.** `server/src/cost/unitCosts.ts` holds order-of-magnitude NYC figures, each marked `VERIFY`. Check them against NYC DOT, Parks and HPD sources before presenting them as real. Zones outside New York are priced with the same NYC numbers for now.
- Refresh 311 data with `npm run import:issues --workspace server`. The server also refreshes it every hour while running.

## Tests

```bash
npm test          # 63 tests: schemas, zone grid, OpenStreetMap parsing, geometry, costs, render queue, HTTP API, and the SQL migration (run in PGlite)
npm run typecheck
cd mobile && npx expo-doctor
```
