// QR code matrix + SVG for tickets. Encoder: QRCode for JavaScript by Kazuhiko Arase (MIT),
// vendored from qrcode-terminal in ./qrcode.
// Static imports so Netlify's bundler (esbuild) packs the encoder into the function.
import QRCode from "./qrcode/index.cjs";
import ECL from "./qrcode/QRErrorCorrectLevel.cjs";

export function qrRows(text) {
  const qr = new QRCode(-1, ECL.M);
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) { let s = ""; for (let c = 0; c < n; c++) s += qr.isDark(r, c) ? "1" : "0"; rows.push(s); }
  return rows;
}
