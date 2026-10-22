// Lead CRM API used by /crm and by the website's lead form.
// POST   /api/leads        -> new lead from the website form (public)
// GET    /api/leads        -> all leads, newest first
// PATCH  /api/leads        -> { id, status? } | { id, addNote } | { id, deleteNote }
// DELETE /api/leads?id=... -> remove one lead
// If the CRM_PASSWORD environment variable is set in Netlify, everything except
// POST needs it in the x-crm-key header; if it isn't set, the CRM is open.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { saveLead } from "../lib/save-lead.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const STATUSES = ["New", "Contacted", "Consult booked", "Client", "Not interested"];

// Leads from before the CRM existed live in the LEAD_SEED environment variable
// (kept out of this public repo). Each one is added once.
function seedLeads() {
  try { return JSON.parse(process.env.LEAD_SEED || "[]"); } catch { return []; }
}
async function ensureSeed(store) {
  const done = new Set(((await store.get("_seeded_ids")) || "").split(",").filter(Boolean));
  let changed = false;
  for (const l of seedLeads()) {
    if (!l || !l.id || done.has(l.id)) continue;
    await store.setJSON(l.id, { ...l, status: "New", notes: [], updated_at: l.created_at }, { onlyIfNew: true });
    done.add(l.id); changed = true;
  }
  if (changed) await store.set("_seeded_ids", [...done].join(","));
}

// Older leads kept notes as one block of text; turn that into a timestamped note.
function normalize(lead) {
  if (!Array.isArray(lead.notes)) {
    const t = String(lead.notes || "").trim();
    lead.notes = t ? [{ id: "legacy", text: t, at: lead.updated_at || lead.created_at }] : [];
  }
  return lead;
}

const hash = (s) => createHash("sha256").update(String(s)).digest();
const authorized = (req) =>
  !process.env.CRM_PASSWORD || timingSafeEqual(hash(req.headers.get("x-crm-key") || ""), hash(process.env.CRM_PASSWORD));

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);

export default async (req) => {
  const store = getStore({ name: "leads", consistency: "strong" });

  if (req.method === "POST") {
    let d;
    try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (d["bot-field"]) return json({ ok: true });
    const result = await saveLead(store, {
      name: d.first_name, phone: d.phone, email: d.email, goal: d.goal, aim: d.aim, referrer: d.referrer,
    });
    console.log("crm: website lead", result);
    return json({ ok: result !== "invalid" }, result === "invalid" ? 400 : 201);
  }

  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") {
    await ensureSeed(store);
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.filter((b) => !b.key.startsWith("_")).map((b) => store.get(b.key, { type: "json" })));
    const leads = items.filter(Boolean).map(normalize).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return json({ leads, statuses: STATUSES });
  }

  if (req.method === "PATCH") {
    let d;
    try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    const id = clean(d.id, 64);
    const raw = id && !id.startsWith("_") ? await store.get(id, { type: "json" }) : null;
    if (!raw) return json({ error: "not found" }, 404);
    const lead = normalize(raw);
    if (d.status !== undefined) {
      if (!STATUSES.includes(d.status)) return json({ error: "bad status" }, 400);
      lead.status = d.status;
    }
    if (d.addNote !== undefined) {
      const text = clean(d.addNote, 2000);
      if (!text) return json({ error: "empty note" }, 400);
      lead.notes.unshift({ id: randomUUID(), text, at: new Date().toISOString() });
    }
    if (d.deleteNote !== undefined) lead.notes = lead.notes.filter((n) => n.id !== d.deleteNote);
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
