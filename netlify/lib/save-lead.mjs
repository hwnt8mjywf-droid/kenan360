import { randomBytes, createHash } from "node:crypto";
// Shared by the website endpoint (/api/leads) and the Netlify form hook.
// Coaching leads: one per phone number (key "p_<digits>").
// Boot camp sign-ups: one per phone number (key "b_<digits>"), with every
// Saturday that person has signed up for in `sessions`.
// Kenan's birthday pregame RSVPs: one per phone number (key "v_<digits>").
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
export const phoneDigits = (p) => String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

// Boot camp runs every Saturday at 10:30 AM starting Nov 14, 2026.
export const BOOTCAMP_START = "2026-11-14";
export function validSession(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d) && d.getUTCDay() === 6 && s >= BOOTCAMP_START;
}

const sourceOf = (ref) => (String(ref || "").includes("fbclid") ? "Instagram / Facebook" : "Website");

export async function saveLead(store, d) {
  const name = clean(d.name, 60);
  const phone = clean(d.phone, 30);
  const digits = phoneDigits(phone);
  if (!name || digits.length < 7) return "invalid";

  const key = "p_" + digits;
  if (await store.get(key)) return "duplicate";
  // Leads saved before keys were phone-based are keyed by submission id; check their phones too.
  const { blobs } = await store.list();
  for (const b of blobs) {
    if (/^(_|p_|b_|v_)/.test(b.key)) continue;
    const l = await store.get(b.key, { type: "json" });
    if (l && l.kind !== "bootcamp" && phoneDigits(l.phone) === digits) return "duplicate";
  }

  const now = new Date().toISOString();
  await store.setJSON(
    key,
    {
      id: key, kind: "lead", created_at: now, name, phone, email: clean(d.email, 120), goal: clean(d.goal, 60), aim: clean(d.aim, 60),
      source: sourceOf(d.referrer), status: "New", notes: [], updated_at: now,
    },
    { onlyIfNew: true }
  );
  return "saved";
}

export async function saveBootcamp(store, d) {
  const name = clean(d.name, 80);
  const phone = clean(d.phone, 30);
  const digits = phoneDigits(phone);
  const session = clean(d.session, 10);
  if (!name || digits.length < 7 || !validSession(session)) return "invalid";

  const key = "b_" + digits;
  const now = new Date().toISOString();
  const existing = await store.get(key, { type: "json" });
  if (existing) {
    // Same person signing up again: add the new Saturday, keep everything else.
    const sessions = new Set(existing.sessions || []);
    if (sessions.has(session)) return "duplicate";
    sessions.add(session);
    existing.sessions = [...sessions].sort();
    existing.name = name || existing.name;
    existing.email = clean(d.email, 120) || existing.email;
    existing.updated_at = now;
    existing.last_signup = now;
    await store.setJSON(key, existing);
    return "added-session";
  }
  await store.setJSON(
    key,
    {
      id: key, kind: "bootcamp", created_at: now, last_signup: now, name, phone, email: clean(d.email, 120),
      sessions: [session], level: clean(d.level, 40), source: sourceOf(d.referrer),
      status: "Signed up", notes: [], updated_at: now,
    },
    { onlyIfNew: true }
  );
  return "saved";
}

// Kenan's Birthday Pregame — Sundays Best Rooftop, Fri Nov 6, 2026, 9 PM – 1 AM. Free entry.
export const RSVP_EVENT = {
  id: "bday-2026", label: "Kenan's Birthday Pregame · Fri, Nov 6 · 9 PM", closes: "2026-11-07T08:00:00Z",
  starts: "2026-11-06T21:00:00-07:00", ends: "2026-11-07T01:00:00-07:00",
  venue: "Sundays Best Rooftop", area: "Downtown SLC", url: "https://kenan360.net/pregame",
};

export const newTicketToken = () => randomBytes(12).toString("base64url");
// Ticket code shown under the QR (and in Wallet): short, easy to read out at the door.
export const ticketCode = (t) => "K360-" + createHash("sha256").update(String(t)).digest("hex").slice(0, 6).toUpperCase();

// Returns { result, token }. Every RSVP gets a private ticket token; an index blob
// "_t_<token>" points to the RSVP so the ticket page can look it up.
export async function saveRsvp(store, d) {
  const first = clean(d.first_name, 40), last = clean(d.last_name, 40);
  const name = [first, last].filter(Boolean).join(" ");
  const phone = clean(d.phone, 30);
  const digits = phoneDigits(phone);
  if (!first || digits.length < 10) return { result: "invalid" };
  if (new Date() > new Date(RSVP_EVENT.closes)) return { result: "closed" };
  const guests = Math.max(0, Math.min(5, Math.round(Number(d.guests) || 0)));
  const showName = d.show_name !== false && d.show_name !== "no";

  const key = "v_" + digits;
  const now = new Date().toISOString();
  const existing = await store.get(key, { type: "json" });
  if (existing) {
    // Same phone RSVPing again: update their details, keep status, notes and ticket.
    Object.assign(existing, { name, first, last, email: clean(d.email, 120) || existing.email, guests, showName, updated_at: now, last_signup: now });
    if (existing.status === "Cancelled") existing.status = "Going";
    if (!existing.ticket) existing.ticket = newTicketToken();
    await store.setJSON(key, existing);
    await store.set("_t_" + existing.ticket, key);
    return { result: "updated", token: existing.ticket };
  }
  const ticket = newTicketToken();
  await store.setJSON(
    key,
    {
      id: key, kind: "rsvp", event: RSVP_EVENT.id, created_at: now, last_signup: now, name, first, last, phone,
      email: clean(d.email, 120), guests, showName, ticket, source: sourceOf(d.referrer), status: "Going", notes: [], updated_at: now,
    },
    { onlyIfNew: true }
  );
  await store.set("_t_" + ticket, key);
  return { result: "saved", token: ticket };
}

export async function findTicket(store, token) {
  const t = String(token || "");
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(t)) return null;
  const key = await store.get("_t_" + t);
  const r = key ? await store.get(key, { type: "json" }) : null;
  return r && r.ticket === t ? r : null;
}
