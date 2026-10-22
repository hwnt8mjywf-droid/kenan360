// Lead CRM API used by /crm. If the CRM_PASSWORD environment variable is set in
// Netlify, every request needs it in the x-crm-key header; if not, it's open.
// GET    /api/leads        -> all leads, newest first
// PATCH  /api/leads        -> { id, status?, notes? } update one lead
// DELETE /api/leads?id=... -> remove one lead
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash } from "node:crypto";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const STATUSES = ["New", "Contacted", "Consult booked", "Client", "Not interested"];

// Leads that came in before the CRM existed live in the LEAD_SEED environment
// variable (kept out of this public repo). Added once, automatically.
function seedLeads() {
  try { return JSON.parse(process.env.LEAD_SEED || "[]"); } catch { return []; }
}

const hash = (s) => createHash("sha256").update(String(s)).digest();
function authorized(req) {
  const expected = process.env.CRM_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(hash(req.headers.get("x-crm-key") || ""), hash(expected));
}

async function ensureSeed(store) {
  const flag = await store.get("_seeded");
  if (flag) return;
  for (const l of seedLeads()) if (l && l.id) await store.setJSON(l.id, { ...l, status: "New", notes: "", updated_at: l.created_at }, { onlyIfNew: true });
  await store.set("_seeded", "1");
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").slice(0, max);

export default async (req) => {
  // No password set in Netlify = CRM is open to anyone with the link.
  if (process.env.CRM_PASSWORD && !authorized(req)) return json({ error: "unauthorized" }, 401);

  const store = getStore({ name: "leads", consistency: "strong" });

  if (req.method === "GET") {
    await ensureSeed(store);
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.filter((b) => !b.key.startsWith("_")).map((b) => store.get(b.key, { type: "json" })));
    const leads = items.filter(Boolean).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return json({ leads, statuses: STATUSES });
  }

  if (req.method === "PATCH") {
    let d;
    try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    const id = clean(d.id, 64);
    const lead = id && !id.startsWith("_") ? await store.get(id, { type: "json" }) : null;
    if (!lead) return json({ error: "not found" }, 404);
    if (d.status !== undefined) {
      if (!STATUSES.includes(d.status)) return json({ error: "bad status" }, 400);
      lead.status = d.status;
    }
    if (d.notes !== undefined) lead.notes = clean(d.notes, 4000);
    lead.updated_at = new Date().toISOString();
    await store.setJSON(id, lead);
    return json({ ok: true, lead });
  }

  if (req.method === "DELETE") {
    const id = clean(new URL(req.url).searchParams.get("id"), 64);
    if (!id || id.startsWith("_")) return json({ error: "bad id" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/leads" };
