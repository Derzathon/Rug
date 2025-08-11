# RUG Overlay – Hosted (Birdeye REST)

## What this is
A tiny Node/Express service that:
- serves the overlay at `/overlay`
- streams events via SSE at `/events`
- polls **Dexscreener** for market cap + best pair
- polls **Birdeye REST** for latest trades on the SOL-quoted pair (requires API key)

## Setup (local)
1) `cp .env.example .env` and set:
   - `MINT=...` (your token mint)
   - `BIRDEYE_API_KEY=...` (get it from Birdeye dashboard)
2) Put your assets in `public/overlay/assets/`:
   - backgrounds: `bg1..bg4.(png|jpg|jpeg|webp)`
   - animations: `idle.webm, animL1..L5.webm, milestone.webm`
3) `npm install`
4) `npm start`
5) Open `http://localhost:3000/overlay`

## Test without real buys
Run:
  - `curl "http://localhost:3000/debug/fake-buy?sol=1"`
  - Triggers the L3 animation + thank-you popup.

## Deploy (Render / Railway)
- Web Service
- Build: `npm install`
- Start: `node server.js`
- Env Vars: `MINT`, `BIRDEYE_API_KEY`
- Overlay URL (example): `https://YOURAPP.onrender.com/overlay`
