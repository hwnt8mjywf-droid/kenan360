# Kenan 360 website

- `public/index.html` — the whole site (one file)
- `netlify/functions/reviews.mjs` — saves and serves client reviews (stored in Netlify Blobs)
- `netlify/functions/seed.mjs` — one-time import of the first three reviews

Deploys automatically from this repo via Netlify.
