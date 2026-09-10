// アイコンを作り直すためのもの。ふだんは動かさなくてよい。
//
//   cd rakuten-marathon/icons && node make-icons.js
//
// Playwright（Chromium）で SVG を描いて PNG に落としている。手で PNG を
// 描き直すと 3 サイズがずれるので、必ずここから作る。
const { chromium } = require("playwright");

const CRIMSON = "#bf0000";
const CRIMSON_DARK = "#8f0000";
const GOLD = "#f0a202";

// 赤地に白い買い物袋。袋の中の 3本の棒は、買いまわりで倍率が積み上がる
// ようす。右下の金色の丸はポイント。
const APP_ICON = `
  <rect width="512" height="512" fill="${CRIMSON}"/>
  <path d="M196 168 a60 60 0 0 1 120 0" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
  <path d="M120 158 h272 l26 250 a34 34 0 0 1 -34 38 h-256 a34 34 0 0 1 -34 -38 Z"
        fill="#fff"/>
  <rect x="176" y="300" width="38" height="66" rx="8" fill="${CRIMSON_DARK}" opacity="0.9"/>
  <rect x="237" y="270" width="38" height="96" rx="8" fill="${CRIMSON_DARK}" opacity="0.9"/>
  <rect x="298" y="238" width="38" height="128" rx="8" fill="${CRIMSON_DARK}" opacity="0.9"/>
  <g transform="translate(378 378)">
    <circle cx="0" cy="0" r="82" fill="${CRIMSON}"/>
    <circle cx="0" cy="0" r="66" fill="${GOLD}"/>
    <text x="0" y="26" text-anchor="middle" font-size="86" font-weight="800"
          font-family="Helvetica, Arial, sans-serif" fill="#fff">P</text>
  </g>`;

const SIZES = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "apple-touch-icon.png"],
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage();
  for (const [size, name] of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block}</style>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
        `viewBox="0 0 512 512">${APP_ICON}</svg>`
    );
    await page.screenshot({ path: name });
    console.log("wrote", name);
  }
  await browser.close();
})();
