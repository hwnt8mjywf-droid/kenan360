# Kenan 360 website

- `public/index.html` — the whole site (one file)
- `public/bootcamp/` — Saturday Boot Camp sign-up page at kenan360.net/bootcamp
- `public/crm/` — lead CRM at kenan360.net/crm (Coaching Leads + Boot Camp tabs)
- `netlify/functions/reviews.mjs` — saves and serves client reviews (stored in Netlify Blobs)
- `netlify/functions/leads.mjs` — CRM API (needs the `CRM_PASSWORD` environment variable)
- `netlify/functions/submission-created.mjs` — backup: copies lead form submissions into the CRM (the form also saves directly via /api/leads)

Deploys automatically from this repo via Netlify.
- `netlify/lib/save-lead.mjs` — shared lead-saving logic (one lead per phone number)
- `public/pregame/` — Kenan's Birthday Pregame RSVP landing page at kenan360.net/pregame (kenan360.net/rsvp redirects there). RSVPs save into the CRM (Birthday RSVPs tab) and email Kenan; the public guest list comes from `netlify/functions/rsvp.mjs` (first name + last initial only)
- `public/pregame/ticket/` — each guest's ticket with QR code (kenan360.net/pregame/ticket/?t=...). Scanning a QR on a phone that's logged in to /crm shows a Door check-in button
- `netlify/functions/pass.mjs` — Apple Wallet ticket (.pkpass). Turns on once these Netlify env vars are set: PASS_TYPE_ID, APPLE_TEAM_ID, PASS_CERT_PEM, PASS_KEY_PEM, PASS_KEY_PASSWORD (if any), PASS_WWDR_PEM (Apple WWDR G4). The ticket page hides the Wallet button until then
- `netlify/lib/qrcode/` — QR encoder by Kazuhiko Arase (MIT), vendored
