// Birthday pregame (/pregame) public API.
// GET  /api/rsvp            -> guest list { total, count, hidden, guests: [{ name: "Jimmy M.", plus }], closed }
//                              (first name + last initial only, and only people who chose to be listed)
// GET  /api/rsvp?t=TOKEN    -> one ticket { name, guests, status, code, qr, wallet, ... }
// POST /api/rsvp            -> { t, action: "checkin" | "undo" } door check-in (needs the CRM password in x-crm-key)
// Phones and emails never leave the CRM.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash } from "node:crypto";
import { RSVP_EVENT, findTicket, ticketCode } from "../lib/save-lead.mjs";
import { qrRows } from "../lib/qr.mjs";
import { walletCreds } from "../lib/pkpass.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const cap = (s) => String(s || "").trim().replace(/^./, (c) => c.toUpperCase());
const hash = (s) => createHash("sha256").update(String(s)).digest();
const isAdmin = (req) => !!process.env.CRM_PASSWORD && timingSafeEqual(hash(req.headers.get("x-crm-key") || ""), hash(process.env.CRM_PASSWORD));
export const ticketUrl = (t) => RSVP_EVENT.url + "/ticket/?t=" + t;

function ticketView(r, admin) {
  return {
    name: [cap(r.first), cap(r.last)].filter(Boolean).join(" ") || r.name,
    guests: r.guests || 0, status: r.status, code: ticketCode(r.ticket),
    checked_in_at: r.checked_in_at || null, created_at: r.created_at,
    qr: qrRows(ticketUrl(r.ticket)), wallet: !!walletCreds(), admin,
    event: { label: RSVP_EVENT.label, venue: RSVP_EVENT.venue, area: RSVP_EVENT.area, starts: RSVP_EVENT.starts, ends: RSVP_EVENT.ends },
  };
}

export default async (req) => {
  const store = getStore({ name: "leads", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.has("t")) {
    const r = await findTicket(store, url.searchParams.get("t"));
    if (!r) return json({ error: "not found" }, 404);
    return json(ticketView(r, isAdmin(req)));
  }

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "v_" });
    const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }))))
      .filter((r) => r && r.kind === "rsvp" && r.status !== "Cancelled")
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const total = items.reduce((n, r) => n + 1 + (r.guests || 0), 0);
    const guests = items.filter((r) => r.showName !== false).map((r) => ({
      name: cap(r.first || String(r.name).split(" ")[0]) + (r.last ? " " + r.last.trim()[0].toUpperCase() + "." : ""),
      plus: r.guests || 0,
    }));
    return json({ total, count: items.length, hidden: items.length - guests.length, guests, closed: new Date() > new Date(RSVP_EVENT.closes) });
  }

  if (req.method === "POST") {
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
    let d; try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    const r = await findTicket(store, d.t);
    if (!r) return json({ error: "not found" }, 404);
    if (d.action === "checkin") { r.status = "Checked in"; r.checked_in_at = new Date().toISOString(); }
    else if (d.action === "undo") { r.status = "Going"; delete r.checked_in_at; }
    else return json({ error: "bad action" }, 400);
    r.updated_at = new Date().toISOString();
    await store.setJSON(r.id, r);
    return json(ticketView(r, true));
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/rsvp" };
