// Renders the 10 extraction test cases to fixtures/images/<id>.jpg (synthetic receipts on a "desk",
// slightly rotated, with blur/fade where the case calls for it). Real photos placed there are kept.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { TEST_CASES } from "../src/extraction/test-cases";

const out = path.resolve("fixtures/images");
fs.mkdirSync(out, { recursive: true });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

for (const c of TEST_CASES) {
  const file = path.join(out, `${c.id}.jpg`);
  if (fs.existsSync(file) && !process.argv.includes("--force")) continue;
  const { lines, rtl, handwritten, effect } = c.render;
  const W = 620;
  const lh = handwritten ? 58 : 34;
  const H = 80 + lines.length * lh;
  const font = handwritten ? "FreeSerif" : rtl ? "DejaVu Sans" : "DejaVu Sans Mono";
  const size = handwritten ? 40 : rtl ? 26 : 21;
  const text = lines
    .map((l, i) => {
      const y = 60 + i * lh;
      const x = rtl ? W - 40 : 40;
      const tilt = handwritten ? ` transform="rotate(${(i % 3) - 1} ${x} ${y})"` : "";
      return `<text x="${x}" y="${y}" ${rtl ? 'text-anchor="end"' : ""} font-family="${font}" ${handwritten ? 'font-style="italic"' : ""} font-size="${size}" fill="${handwritten ? "#1d3a8a" : "#222"}"${tilt}>${esc(l)}</text>`;
    })
    .join("\n");
  const paper = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${handwritten ? "#fbf7e9" : "#fdfdfb"}"/>${handwritten ? Array.from({ length: lines.length + 1 }, (_, i) => `<line x1="20" x2="${W - 20}" y1="${72 + i * lh}" y2="${72 + i * lh}" stroke="#c9d6ee"/>`).join("") : ""}${text}</svg>`;

  let img = sharp(Buffer.from(paper));
  if (effect === "fade") img = img.linear(0.35, 165).modulate({ brightness: 1.05 });
  let receipt = await img.png().toBuffer();
  receipt = await sharp(receipt).rotate(c.id.charCodeAt(1) % 2 ? 2.5 : -2, { background: "#3b2f2a" }).png().toBuffer();
  const meta = await sharp(receipt).metadata();
  let photo = sharp({ create: { width: meta.width! + 160, height: meta.height! + 200, channels: 3, background: "#3b2f2a" } }).composite([{ input: receipt, top: 100, left: 80 }]);
  let buf = await photo.jpeg({ quality: 88 }).toBuffer();
  if (effect === "blur") buf = await sharp(buf).blur(2.6).jpeg({ quality: 70 }).toBuffer();
  fs.writeFileSync(file, buf);
  console.log("wrote", path.relative(process.cwd(), file));
}
