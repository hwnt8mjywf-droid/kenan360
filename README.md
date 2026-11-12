# Kenan 360 website

- `public/index.html` — the whole site (one file)
- `public/bootcamp/` — Saturday Boot Camp booking page (Acuity-style calendar, spots left, reschedule/cancel link) at kenan360.net/bootcamp
- `public/saturday/` — simple one-screen $25 boot camp booking page for ads at kenan360.net/saturday
- `netlify/functions/bootcamp.mjs` — booking API: availability, booking, reschedule, cancel (`BOOTCAMP_CAPACITY` env var, default 30 spots)
- `public/crm/` — lead CRM at kenan360.net/crm (Coaching Leads + Boot Camp tabs)
- `netlify/functions/reviews.mjs` — saves and serves client reviews (stored in Netlify Blobs)
- `netlify/functions/leads.mjs` — CRM API (needs the `CRM_PASSWORD` environment variable)
- `netlify/functions/submission-created.mjs` — backup: copies lead form submissions into the CRM (the form also saves directly via /api/leads)

Deploys automatically from this repo via Netlify.
- `netlify/lib/save-lead.mjs` — shared lead-saving logic (one lead per phone number)
