// Stores website reviews in Netlify Blobs and serves them to the page.
// GET  /api/reviews  -> newest first, hidden ones left out
// POST /api/reviews  -> save a new review
// To remove a review: Netlify dashboard > Blobs > store "reviews" > delete it.
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export default async (req) => {
  const store = getStore({ name: "reviews", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const reviews = items
      .filter((r) => r && !r.hidden)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map(({ name, rating, service, text, created_at }) => ({ name, rating, service, text, created_at }));
    return json(reviews);
  }

  if (req.method === "POST") {
    let d;
    try { d = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
    const name = clean(d.name, 40), text = clean(d.text, 800), service = clean(d.service, 40);
    const rating = Math.round(Number(d.rating));
    if (!name || text.length < 10 || !(rating >= 1 && rating <= 5)) return json({ ok: false, error: "missing fields" }, 400);
    const created_at = new Date().toISOString();
    const key = created_at.replace(/[:.]/g, "-") + "_" + name.replace(/[^a-z0-9]+/gi, "-").slice(0, 30);
    await store.setJSON(key, { name, rating, service, text, created_at, hidden: false });
    return json({ ok: true }, 201);
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/reviews" };
