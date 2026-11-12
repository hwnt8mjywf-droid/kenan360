// Lineup Studio API used by /studio.
// GET    /api/studio                -> every saved document { "events/current": {...}, "artists/x": {...}, ... }
// PUT    /api/studio  { path, data } -> save one document (events/current, lineups/<date>, artists/<id>, studio/media)
// POST   /api/studio/upload         -> raw file body (photo, clip, music); returns { id }
// POST   /api/studio/import  { url } -> copies a Runway clip link into the site; returns { id }
// GET    /api/studio/file/<id>      -> the stored file (served at /_blob/<id>)
// Everything except reading a stored file needs the CRM password (CRM_PASSWORD) in x-crm-key.
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import seed from "../lib/studio-seed.json";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hash = (s) => createHash("sha256").update(String(s)).digest();
const authorized = (req) =>
  !process.env.CRM_PASSWORD || timingSafeEqual(hash(req.headers.get("x-crm-key") || ""), hash(process.env.CRM_PASSWORD));

const DOC_PATH = /^(events\/current|studio\/media|artists\/[\w-]{1,80}|lineups\/[\w-]{1,80})$/;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "audio/mp4", "audio/x-m4a"];
const MAX_FILE = 25 * 1024 * 1024;
// Only Runway's own CDN can be imported, so this can't be used to fetch anything else.
const IMPORT_HOSTS = ["dnznrvs05pmza.cloudfront.net"];

async function allDocs(store) {
  if (!(await store.get("_seeded"))) {
    for (const [k, v] of Object.entries(seed)) await store.setJSON(k, v, { onlyIfNew: true });
    await store.set("_seeded", "1");
  }
  const { blobs } = await store.list();
  const out = {};
  await Promise.all(blobs.filter((b) => !b.key.startsWith("_")).map(async (b) => { out[b.key] = await store.get(b.key, { type: "json" }); }));
  return out;
}

async function saveFile(files, bytes, type) {
  const id = randomUUID().replace(/-/g, "");
  await files.set(id, bytes, { metadata: { type } });
  return id;
}

export default async (req) => {
  const url = new URL(req.url);
  // /_blob/<id> is rewritten here, but req.url keeps the original path, so map it back.
  const sub = url.pathname.replace(/^\/_blob\//, "file/").replace(/^\/api\/studio\/?/, "");
  const docs = getStore({ name: "studio", consistency: "strong" });
  const files = getStore({ name: "studio-files", consistency: "strong" });

  if (req.method === "GET" && sub.startsWith("file/")) {
    const id = sub.slice(5);
    if (!/^[a-f0-9]{32}$/.test(id)) return new Response("not found", { status: 404 });
    const r = await files.getWithMetadata(id, { type: "stream" });
    if (!r) return new Response("not found", { status: 404 });
    return new Response(r.data, { headers: { "content-type": r.metadata.type || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  }

  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET" && !sub) return json({ docs: await allDocs(docs) });

  if (req.method === "PUT" && !sub) {
    let d; try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (!DOC_PATH.test(d.path || "") || typeof d.data !== "object" || !d.data) return json({ error: "bad path" }, 400);
    await docs.setJSON(d.path, d.data);
    return json({ ok: true });
  }

  if (req.method === "POST" && sub === "upload") {
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!FILE_TYPES.includes(type)) return json({ error: "unsupported_type" }, 415);
    const bytes = await req.arrayBuffer();
    const up = url.searchParams.get("up");
    if (up) {
      // Chunked upload: parts 0..of-1 arrive in order; the last one assembles the file.
      const part = +url.searchParams.get("part"), of = +url.searchParams.get("of");
      if (!/^[a-f0-9]{32}$/.test(up) || !Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > 8 || part < 0 || part >= of)
        return json({ error: "bad request" }, 400);
      await files.set("_part-" + up + "-" + part, bytes);
      if (part < of - 1) return json({ ok: true, part });
      const parts = [];
      for (let i = 0; i < of; i++) {
        const b = await files.get("_part-" + up + "-" + i, { type: "arrayBuffer" });
        if (!b) return json({ error: "missing part " + i }, 400);
        parts.push(new Uint8Array(b));
      }
      const total = parts.reduce((t, p) => t + p.byteLength, 0);
      await Promise.all(parts.map((_, i) => files.delete("_part-" + up + "-" + i)));
      if (total > MAX_FILE) return json({ error: "too_large" }, 413);
      const all = new Uint8Array(total); let off = 0;
      for (const p of parts) { all.set(p, off); off += p.byteLength; }
      return json({ id: await saveFile(files, all, type) });
    }
    if (bytes.byteLength > MAX_FILE) return json({ error: "too_large" }, 413);
    return json({ id: await saveFile(files, bytes, type) });
  }

  if (req.method === "POST" && sub === "import") {
    let d; try { d = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    let src; try { src = new URL(d.url); } catch { return json({ error: "bad url" }, 400); }
    if (src.protocol !== "https:" || !IMPORT_HOSTS.includes(src.hostname)) return json({ error: "not a Runway link" }, 400);
    const r = await fetch(src);
    if (!r.ok) return json({ error: "Runway link failed (" + r.status + ")" }, 502);
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > MAX_FILE) return json({ error: "too_large" }, 413);
    return json({ id: await saveFile(files, bytes, "video/mp4") });
  }

  return json({ error: "not found" }, 404);
};

export const config = { path: ["/api/studio", "/api/studio/*"] };
