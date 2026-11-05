// Builds a signed Apple Wallet pass (.pkpass) with Node's built-in crypto only.
// A .pkpass is a zip of pass.json + images + manifest.json (SHA-1 of every file)
// + signature (a detached PKCS#7 / CMS signature of manifest.json made with the
// Pass Type ID certificate, with Apple's WWDR intermediate certificate included).
import { createHash, createPrivateKey, createSign, X509Certificate } from "node:crypto";

/* ---------- tiny DER helpers ---------- */
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = []; while (n) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const int = (n) => tlv(0x02, Buffer.from([n]));
const octet = (b) => tlv(0x04, b);
const NULL = Buffer.from([0x05, 0x00]);
function oid(str) {
  const p = str.split(".").map(Number), out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) { const s = []; let x = v; do { s.unshift(x & 0x7f); x >>= 7; } while (x); s.forEach((b, i) => out.push(i < s.length - 1 ? b | 0x80 : b)); }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  return tlv(0x17, Buffer.from(s, "ascii"));
}
// Read one TLV at offset; returns { tag, start, hdr, end } (raw bytes = buf.slice(start, end)).
function readTlv(buf, off) {
  const tag = buf[off]; let l = buf[off + 1], hdr = 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = (l << 8) | buf[off + 2 + i]; hdr += n; }
  return { tag, start: off, hdr, end: off + hdr + l };
}
function children(buf, t) { const out = []; let o = t.start + t.hdr; while (o < t.end) { const c = readTlv(buf, o); out.push(c); o = c.end; } return out; }

// Issuer Name and serial number (raw DER) of a certificate, for IssuerAndSerialNumber.
function issuerAndSerial(certDer) {
  const cert = readTlv(certDer, 0), tbs = children(certDer, cert)[0], f = children(certDer, tbs);
  const i = f[0].tag === 0xa0 ? 1 : 0; // skip [0] version
  const raw = (t) => certDer.subarray(t.start, t.end);
  return seq(raw(f[i + 2]), raw(f[i])); // issuer, serial
}

const pemToDer = (pem) => new X509Certificate(pem).raw;

const OID = {
  data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", sha256: "2.16.840.1.101.3.4.2.1",
  rsa: "1.2.840.113549.1.1.1", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4", signingTime: "1.2.840.113549.1.9.5",
};

export function signManifest(manifest, { certPem, keyPem, keyPassword, wwdrPem }) {
  const certDer = pemToDer(certPem), wwdrDer = pemToDer(wwdrPem);
  const key = createPrivateKey({ key: keyPem, passphrase: keyPassword || undefined });
  const digest = createHash("sha256").update(manifest).digest();

  // Signed attributes, in DER (sorted) order: contentType, messageDigest, signingTime
  const attrs = [
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utcTime(new Date()))),
    seq(oid(OID.messageDigest), set(octet(digest))),
  ].sort(Buffer.compare);
  const attrsSet = set(...attrs);
  const sig = createSign("sha256").update(attrsSet).sign(key);
  const signedAttrs = Buffer.concat([Buffer.from([0xa0]), attrsSet.subarray(1)]); // [0] IMPLICIT

  const signerInfo = seq(int(1), issuerAndSerial(certDer), seq(oid(OID.sha256), NULL), signedAttrs, seq(oid(OID.rsa), NULL), octet(sig));
  const signedData = seq(
    int(1),
    set(seq(oid(OID.sha256), NULL)),
    seq(oid(OID.data)),
    tlv(0xa0, certDer, wwdrDer),
    set(signerInfo),
  );
  return seq(oid(OID.signedData), tlv(0xa0, signedData));
}

/* ---------- minimal zip (stored, no compression) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const local = [], central = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, e]);
}

export function buildPkpass(passJson, images, creds) {
  const files = { "pass.json": Buffer.from(JSON.stringify(passJson)) };
  for (const [k, b64] of Object.entries(images)) files[k] = Buffer.from(b64, "base64");
  const manifest = {};
  for (const [k, v] of Object.entries(files)) manifest[k] = createHash("sha1").update(v).digest("hex");
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  files["signature"] = signManifest(files["manifest.json"], creds);
  return zip(files);
}

// Credentials come from Netlify environment variables (never from this public repo).
// Certificates/keys may be pasted as PEM or as base64 of the PEM.
const pem = (v) => { const s = String(v || "").trim(); if (!s) return ""; return s.includes("-----BEGIN") ? s.replace(/\\n/g, "\n") : Buffer.from(s, "base64").toString("utf8"); };
export function walletCreds() {
  const c = {
    passTypeId: process.env.PASS_TYPE_ID, teamId: process.env.APPLE_TEAM_ID,
    certPem: pem(process.env.PASS_CERT_PEM), keyPem: pem(process.env.PASS_KEY_PEM),
    keyPassword: process.env.PASS_KEY_PASSWORD, wwdrPem: pem(process.env.PASS_WWDR_PEM),
  };
  return c.passTypeId && c.teamId && c.certPem && c.keyPem && c.wwdrPem ? c : null;
}
