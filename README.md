# Kenan 360 website

- `public/index.html` — the whole site (one file)
- `public/crm/` — password-protected lead CRM at kenan360.net/crm
- `netlify/functions/reviews.mjs` — saves and serves client reviews (stored in Netlify Blobs)
- `netlify/functions/leads.mjs` — CRM API (needs the `CRM_PASSWORD` environment variable)
- `netlify/functions/submission-created.mjs` — copies every lead form submission into the CRM

Deploys automatically from this repo via Netlify.
