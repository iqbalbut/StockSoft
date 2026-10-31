import sharp from "sharp";

const svg = (pad: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#1f57d1"/>
<g transform="translate(${256 - 150 + pad / 2} ${256 - 170 + pad / 2}) scale(${(300 - pad) / 300})">
<path d="M30 0h240v340l-40-25-40 25-40-25-40 25-40-25-40 25z" fill="#fff"/>
<rect x="70" y="70" width="160" height="22" rx="11" fill="#1f57d1"/>
<rect x="70" y="125" width="120" height="18" rx="9" fill="#9db8f5"/>
<rect x="70" y="165" width="140" height="18" rx="9" fill="#9db8f5"/>
<path d="M95 250l35 35 75-80" stroke="#16a34a" stroke-width="28" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</g></svg>`);

await sharp(svg(0)).resize(512).png().toFile("public/icons/icon-512.png");
await sharp(svg(0)).resize(192).png().toFile("public/icons/icon-192.png");
await sharp(svg(0)).resize(180).png().toFile("public/icons/apple-touch-icon.png");
await sharp(svg(120)).resize(512).png().toFile("public/icons/icon-maskable-512.png");
console.log("icons written");
