// Acuity-style booking API for the Saturday Boot Camp (kenan360.net/bootcamp).
// GET  /api/bootcamp                 -> { capacity, cutoff, booked: { "YYYY-MM-DD": n } }
// GET  /api/bootcamp?manage=<token>  -> { name, sessions } for the reschedule/cancel screen
// POST /api/bootcamp { action: "book", first_name, last_name, phone, email, level, session, referrer }
// POST /api/bootcamp { action: "cancel", token, session }
// POST /api/bootcamp { action: "reschedule", token, from, to }
// Spots per Saturday: BOOTCAMP_CAPACITY environment variable (default 30).
// Sign-ups are the same "b_<phone>" records the CRM Boot Camp tab reads.
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { saveBootcamp, phoneDigits, validSession } from "../lib/save-lead.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const CAPACITY = () => Math.max(1, parseInt(process.env.BOOTCAMP_CAPACITY || "30", 10) || 30);
const CLASS_MINUTES = 10 * 60 + 30; // 10:30 AM Mountain Time

function mtNow() {
  const p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).forEach((x) => (p[x.type] = x.value));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: +p.hour * 60 + +p.minute };
}
// A Saturday can be booked until its class starts.
function open(session) {
  if (!validSession(session)) return false;
  const now = mtNow();
  return session > now.date || (session === now.date && now.mins < CLASS_MINUTES);
}

async function signups(store) {
  const { blobs } = await store.list({ prefix: "b_" });
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}
async function bookedCounts(store) {
  const counts = {};
  for (const r of await signups(store)) {
    if (r.status === "Cancelled") continue;
    for (const s of r.sessions || []) counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

async function tokenFor(store, key, rec) {
  if (rec.manage) return rec.manage;
  rec.manage = randomBytes(12).toString("hex");
  await store.setJSON(key, rec);
  await store.set("_m_" + rec.manage, key);
  return rec.manage;
}
async function byToken(store, token) {
  if (!/^[a-f0-9]{24}$/.test(String(token || ""))) return null;
  const key = await store.get("_m_" + token);
  if (!key) return null;
  const rec = await store.get(key, { type: "json" });
  return rec ? { key, rec } : null;
}
const note = (rec, text) => {
  rec.notes = Array.isArray(rec.notes) ? rec.notes : [];
  rec.notes.unshift({ id: randomBytes(8).toString("hex"), text, at: new Date().toISOString() });
};
const label = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const upcoming = (rec) => (rec.sessions || []).filter(open).sort();

export default async (req) => {
  const store = getStore({ name: "leads", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = url.searchParams.get("manage");
    if (token) {
      const hit = await byToken(store, token);
      if (!hit) return json({ error: "not found" }, 404);
      return json({ name: hit.rec.name, sessions: hit.rec.status === "Cancelled" ? [] : upcoming(hit.rec), capacity: CAPACITY(), booked: await bookedCounts(store) });
    }
    return json({ capacity: CAPACITY(), booked: await bookedCounts(store), today: mtNow().date });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let d;
  try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  if (d["bot-field"]) return json({ ok: true });

  if (d.action === "book") {
    const session = String(d.session || "");
    if (!open(session)) return json({ error: "closed", message: "That Saturday is no longer available. Please pick another date." }, 409);
    const digits = phoneDigits(d.phone);
    const key = "b_" + digits;
    const prev = await store.get(key, { type: "json" });
    const already = prev && prev.status !== "Cancelled" && (prev.sessions || []).includes(session);
    if (!already && ((await bookedCounts(store))[session] || 0) >= CAPACITY())
      return json({ error: "full", message: "That Saturday just filled up. Please pick another date." }, 409);

    const result = await saveBootcamp(store, {
      name: [d.first_name, d.last_name].filter(Boolean).join(" "), phone: d.phone, email: d.email,
      session, level: d.level, referrer: d.referrer,
    });
    if (result === "invalid") return json({ error: "invalid", message: "Please check your name and phone number." }, 400);
    const rec = await store.get(key, { type: "json" });
    if (rec.status === "Cancelled") { rec.status = "Signed up"; rec.updated_at = new Date().toISOString(); await store.setJSON(key, rec); }
    const token = await tokenFor(store, key, rec);
    console.log("bootcamp: book", session, result);
    return json({ ok: true, token, already: result === "duplicate" }, 201);
  }

  if (d.action === "cancel" || d.action === "reschedule") {
    const hit = await byToken(store, d.token);
    if (!hit) return json({ error: "not found", message: "We couldn't find that booking." }, 404);
    const { key, rec } = hit;
    const from = String(d.action === "cancel" ? d.session : d.from || "");
    if (!(rec.sessions || []).includes(from) || !open(from))
      return json({ error: "closed", message: "That booking can't be changed anymore. Text Kenan at (848) 350-4771." }, 409);

    if (d.action === "reschedule") {
      const to = String(d.to || "");
      if (!open(to)) return json({ error: "closed", message: "That Saturday isn't available. Pick another date." }, 409);
      if ((rec.sessions || []).includes(to)) return json({ error: "dup", message: "You're already booked for that Saturday." }, 409);
      if (((await bookedCounts(store))[to] || 0) >= CAPACITY()) return json({ error: "full", message: "That Saturday is full. Pick another date." }, 409);
      rec.sessions = rec.sessions.filter((s) => s !== from).concat(to).sort();
      note(rec, `Rescheduled online: ${label(from)} → ${label(to)}`);
    } else {
      rec.sessions = rec.sessions.filter((s) => s !== from);
      note(rec, `Cancelled online: ${label(from)}`);
      if (!upcoming(rec).length) rec.status = "Cancelled";
    }
    rec.updated_at = new Date().toISOString();
    await store.setJSON(key, rec);
    console.log("bootcamp:", d.action, from, d.to || "");
    return json({ ok: true, name: rec.name, sessions: upcoming(rec) });
  }

  return json({ error: "bad action" }, 400);
};

export const config = { path: "/api/bootcamp" };
