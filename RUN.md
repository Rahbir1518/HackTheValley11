# Running Ordis

All commands are PowerShell, run from the repo folder (`C:\Code\HackTheValley\HackTheValley11`) unless a
step says `cd` somewhere. Background on how everything fits together is in `HANDOFF.md`.

---

## 1. One-time setup (already done on this laptop)

```powershell
# Backend
python -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
copy .env.example .env                              # then fill in BLENDER_PATH, LLM keys, GOOGLE_MAPS_API_KEY
backend\.venv\Scripts\python scripts\ingest.py      # downloads City data (~1.7 GB), builds data\ordis.sqlite

# Website
cd frontend; npm install; copy .env.example .env.local; cd ..      # Clerk keys + NEXT_PUBLIC_API_URL=/ordis-api

# Mobile app
cd mobile; npm install; copy .env.example .env.local; cd ..        # Clerk key + tunnel URLs (see section 3)

# Tunnel tool (then close and reopen the terminal)
winget install --id Cloudflare.cloudflared
```

On the phone: install **Expo Go** from the Play Store.

---

## 2. Website only (laptop)

Two terminals:

```powershell
# Terminal 1: backend (API on port 8000)
backend\.venv\Scripts\python -m uvicorn backend.main:app --port 8000
```

```powershell
# Terminal 2: website (http://localhost:3000)
cd frontend; npm run dev
```

Open http://localhost:3000.

**Restart terminal 1 after any backend change** (or add `--reload` to the command while developing).
The website reloads by itself.

---

## 3. Phone demo (website + mobile app through a tunnel)

Four terminals, **in this order**.

```powershell
# Terminal 1: backend
backend\.venv\Scripts\python -m uvicorn backend.main:app --port 8000
```

```powershell
# Terminal 2: website
cd frontend; npm run dev
```

```powershell
# Terminal 3: Cloudflare tunnel (keep this open the whole demo)
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://word-word-word.trycloudflare.com` inside a box. (The
`developers.cloudflare.com` link it also prints is just documentation, not your tunnel.) **The URL
changes every time `cloudflared` restarts**, so if you restart it, redo the next step.

```powershell
# Terminal 4, step A: point the app at the tunnel (reads the live URL from cloudflared itself)
$url = "https://" + (Invoke-RestMethod http://127.0.0.1:20241/quicktunnel).hostname
$url                                              # should end in .trycloudflare.com
$f = "mobile\.env.local"
$lines = (Get-Content $f) -replace '^EXPO_PUBLIC_API_URL=.*', "EXPO_PUBLIC_API_URL=$url/ordis-api" -replace '^EXPO_PUBLIC_WEB_URL=.*', "EXPO_PUBLIC_WEB_URL=$url"
[IO.File]::WriteAllLines((Resolve-Path $f), $lines)
```

Step B: check the tunnel. Open this in any browser; you should see a line of JSON starting `{"llm":`:

```
https://PASTE-YOURS-HERE.trycloudflare.com/ordis-api/api/health
```

```powershell
# Terminal 4, step C: start the app
cd mobile; npx expo start --tunnel --clear
```

When it says **Tunnel ready**, open Expo Go on the phone, tap **Scan QR code** and scan it. Sign in with
your email code.

`frontend\.env.local` must contain `NEXT_PUBLIC_API_URL=/ordis-api` (it already does). That makes the
website and the API share one URL, so one tunnel is enough.

---

## 4. Before a demo: warm the caches (optional, saves AI calls and waiting)

```powershell
# Replays / pre-builds every address in demo_addresses.txt
backend\.venv\Scripts\python -m backend.warm

# Same, plus Street View photos for "From the street" (needs GOOGLE_MAPS_API_KEY;
# cached photos keep working after the key or billing is removed)
backend\.venv\Scripts\python -m backend.warm --street

# One address only
backend\.venv\Scripts\python -m backend.warm "135 Liberty St"
```

---

## 5. Checks (before committing)

```powershell
# Backend tests
backend\.venv\Scripts\python -m pytest backend\tests -q

# Website
cd frontend; npx tsc --noEmit; npx eslint src; cd ..

# Mobile app
cd mobile; npx tsc --noEmit; npx expo lint; npx expo-doctor; cd ..
```

---

## 6. Occasional maintenance

```powershell
# Re-download and reload some City datasets in place
backend\.venv\Scripts\python scripts\ingest.py --only heritage rentals --refresh

# Rebuild 3D scenes after changing Blender materials (no AI calls)
backend\.venv\Scripts\python -m backend.rebuild_scenes

# Run the pipeline for one address in the terminal
backend\.venv\Scripts\python -m backend.run "135 Liberty St"
```

---

## 7. When something goes wrong

| Problem | Fix |
|---|---|
| New backend feature missing / "Not Found" | Restart terminal 1 (the backend only loads code at start). |
| App says "Can't reach the Ordis API" | Open `<tunnel URL>/ordis-api/api/health` in a browser. Fails: check terminals 1 and 3. Works: restart terminal 4 (`npx expo start --tunnel --clear`) so the app rereads `mobile\.env.local`. |
| Cloudflare was restarted (new URL) | Redo section 3, step A, then restart terminal 4. |
| App shows "HTTP 404" | `mobile\.env.local` points at the wrong URL (e.g. the Cloudflare docs link). Redo section 3, step A, then restart terminal 4. |
| Expo Go: "Project is incompatible with this version of Expo Go" | The app is on SDK 57 to match the Play Store's Expo Go. Don't upgrade the SDK until the store's Expo Go supports the new one. |
| Expo: "Install @expo/ngrok and try again" | Run the same command again (`npx expo start --tunnel --clear`). |
| Expo: "ngrok tunnel took too long to connect" | Run the command again; Expo's tunnel service is sometimes slow. |
| Street tab in Site imagery shows an error on the phone | In Google Cloud, add `*.trycloudflare.com/*` to the Maps Embed key's websites (takes up to 5 minutes). |
| "From the street" says to set a key | Put `GOOGLE_MAPS_API_KEY=...` in `.env` (Street View Static API enabled) and restart terminal 1. |
| Gemini errors (403 suspended / quota) | Ordis falls back to Groq automatically; fix or replace `GEMINI_API_KEY` in `.env` when convenient. |
| Port already in use | Something is still running on 8000 / 3000. Close the old terminal, or find it with `Get-NetTCPConnection -LocalPort 8000`. |
