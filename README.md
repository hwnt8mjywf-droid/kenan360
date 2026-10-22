# Kenan 360 website

- `public/index.html` — the whole site (one file)
- `public/crm/` — password-protected lead CRM at kenan360.net/crm
- `netlify/functions/reviews.mjs` — saves and serves client reviews (stored in Netlify Blobs)
- `netlify/functions/leads.mjs` — CRM API (needs the `CRM_PASSWORD` environment variable)
- `netlify/functions/submission-created.mjs` — backup: copies lead form submissions into the CRM (the form also saves directly via /api/leads)

Deploys automatically from this repo via Netlify.
- `netlify/lib/save-lead.mjs` — shared lead-saving logic (one lead per phone number)
