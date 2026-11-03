// Shared by the website endpoint (/api/leads) and the Netlify form hook.
// Coaching leads: one per phone number (key "p_<digits>").
// Boot camp sign-ups: one per phone number (key "b_<digits>"), with every
// Saturday that person has signed up for in `sessions`.
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
    if (/^(_|p_|b_)/.test(b.key)) continue;
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
