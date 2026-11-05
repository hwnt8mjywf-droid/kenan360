// GET /api/pass?t=TOKEN -> Apple Wallet ticket (.pkpass) for one RSVP.
// Needs these Netlify environment variables (from an Apple Developer "Pass Type ID" certificate):
//   PASS_TYPE_ID (e.g. pass.net.kenan360.events), APPLE_TEAM_ID,
//   PASS_CERT_PEM, PASS_KEY_PEM, PASS_KEY_PASSWORD (if the key has one), PASS_WWDR_PEM (Apple WWDR G4)
// Until they're set, this returns 501 and the ticket page hides the Wallet button.
import { getStore } from "@netlify/blobs";
import { RSVP_EVENT, findTicket, ticketCode } from "../lib/save-lead.mjs";
import { buildPkpass, walletCreds } from "../lib/pkpass.mjs";
import { PASS_IMAGES } from "../lib/pass-assets.mjs";

const cap = (s) => String(s || "").trim().replace(/^./, (c) => c.toUpperCase());

export default async (req) => {
  const creds = walletCreds();
  if (!creds) return new Response("Apple Wallet isn't set up yet.", { status: 501 });
  const store = getStore({ name: "leads", consistency: "strong" });
  const r = await findTicket(store, new URL(req.url).searchParams.get("t"));
  if (!r || r.status === "Cancelled") return new Response("Ticket not found.", { status: 404 });

  const name = [cap(r.first), cap(r.last)].filter(Boolean).join(" ") || r.name;
  const link = RSVP_EVENT.url + "/ticket/?t=" + r.ticket;
  const code = ticketCode(r.ticket);
  const pass = {
    formatVersion: 1, passTypeIdentifier: creds.passTypeId, teamIdentifier: creds.teamId,
    serialNumber: RSVP_EVENT.id + "-" + r.ticket, organizationName: "Kenan 360",
    description: "Kenan's Birthday Pregame ticket", logoText: "KENAN360",
    backgroundColor: "rgb(22,17,14)", foregroundColor: "rgb(255,255,255)", labelColor: "rgb(255,95,15)",
    relevantDate: RSVP_EVENT.starts, expirationDate: "2026-11-07T06:00:00-07:00",
    barcodes: [{ format: "PKBarcodeFormatQR", message: link, messageEncoding: "iso-8859-1", altText: code }],
    barcode: { format: "PKBarcodeFormatQR", message: link, messageEncoding: "iso-8859-1", altText: code },
    eventTicket: {
      headerFields: [{ key: "entry", label: "ENTRY", value: "FREE" }],
      primaryFields: [{ key: "event", label: "KENAN'S BIRTHDAY", value: "The Ultimate Pregame" }],
      secondaryFields: [
        { key: "guest", label: "GUEST", value: name },
        { key: "party", label: "PARTY", value: r.guests ? `You +${r.guests}` : "Just you", textAlignment: "PKTextAlignmentRight" },
      ],
      auxiliaryFields: [
        { key: "date", label: "DATE", value: "Fri, Nov 6" },
        { key: "time", label: "TIME", value: "9 PM – 1 AM" },
        { key: "venue", label: "VENUE", value: "Sundays Best Rooftop", textAlignment: "PKTextAlignmentRight" },
      ],
      backFields: [
        { key: "where", label: "Where", value: "Sundays Best Rooftop, Downtown Salt Lake City" },
        { key: "when", label: "When", value: "Friday, November 6, 2026 · 9:00 PM – 1:00 AM" },
        { key: "rules", label: "Good to know", value: "21+ with valid ID. No cover all night. Live DJs, VIP tables." },
        { key: "code", label: "Ticket code", value: code },
        { key: "link", label: "Your ticket", value: link },
      ],
    },
  };
  try {
    const file = buildPkpass(pass, PASS_IMAGES, creds);
    return new Response(file, {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": `attachment; filename="kenans-pregame-${code}.pkpass"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("pass: build failed", err);
    return new Response("Could not create the Wallet ticket.", { status: 500 });
  }
};

export const config = { path: "/api/pass" };
