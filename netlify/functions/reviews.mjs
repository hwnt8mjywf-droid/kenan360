// Stores website reviews in Netlify Blobs and serves them to the page.
// GET  /api/reviews  -> newest first, hidden ones left out
// POST /api/reviews  -> save a new review
// To remove a review: Netlify dashboard > Blobs > store "reviews" > delete it.
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The three reviews that were on the site before storage existed. Added once, automatically.
const SEED = [
  { created_at: "2026-10-15T01:48:52Z", name: "Jimmy Miller", rating: 5, service: "Full 360",
    text: "Working with Ken has honestly gotten me into the best shape of my life. This dude does it all. Workouts, nutrition, accountability, even helping me put outfits together and level up my style. It’s way more than just personal training.\n\nAnd the funniest part? His IG videos actually helped me meet my girlfriend 😂😂 Never thought getting in shape would turn into a whole lifestyle upgrade hahaha.\n\nIf you’re looking for the full package, Ken’s your guy. He knows his stuff and genuinely wants to see you win." },
  { created_at: "2026-10-15T01:16:35Z", name: "Marcus Rivera", rating: 5, service: "Full 360",
    text: "It was great helped me meet all my goals! Great trainer for any begginer looking to get in shape. Highly recommend!!" },
  { created_at: "2026-10-15T01:05:43Z", name: "Jennie Wolf", rating: 5, service: "Full 360",
    text: "Amazing experience working with Ken! He is extremely professional, knowledgeable, and genuinely cares about delivering the best results. His attention to detail, communication, and dedication really set him apart. He goes above and beyond to make sure everything runs smoothly. Highly recommend Ken to anyone looking for someone reliable, hardworking, and exceptional at what he does. Definitely a 5-star experience!" },
];
const keyFor = (r) => r.created_at.replace(/[:.]/g, "-") + "_" + r.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 30);
async function ensureSeed(store) {
  const { blobs } = await store.list();
  const have = new Set(blobs.map((b) => b.key));
  for (const r of SEED) {
    const key = keyFor(r);
    if (!have.has(key)) await store.setJSON(key, { ...r, hidden: false }, { onlyIfNew: true });
  }
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export default async (req) => {
  const store = getStore({ name: "reviews", consistency: "strong" });

  if (req.method === "GET") {
    await ensureSeed(store);
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
    const key = keyFor({ created_at, name });
    await store.setJSON(key, { name, rating, service, text, created_at, hidden: false });
    return json({ ok: true }, 201);
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/reviews" };
