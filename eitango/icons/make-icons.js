// アイコンを作り直すためのもの。ふだんは動かさなくてよい。
//
//   cd eitango/icons && node make-icons.js
//
// Playwright（Chromium）で SVG を描いて PNG に落としている。手で PNG を
// 描き直すと 3 サイズがずれるので、必ずここから作る。
const { chromium } = require("playwright");

const BLUE = "#2b5fab";
const NAVY = "#1f4a8a";
const PURPLE = "#8a4fbf";

// 青地に白い単語カードを2枚。手前のカードに「A」と「あ」。
// マスカブル（丸く切り抜かれる）でも欠けないよう、絵は中央 70% に収める。
const APP_ICON = `
  <rect width="512" height="512" fill="${BLUE}"/>
  <rect x="150" y="118" width="230" height="290" rx="28" fill="#9db8e2" transform="rotate(10 265 263)"/>
  <rect x="132" y="112" width="230" height="290" rx="28" fill="#fff" transform="rotate(-6 247 257)"/>
  <g transform="rotate(-6 247 257)">
    <text x="247" y="262" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-weight="900" font-size="170" fill="${NAVY}">A</text>
    <line x1="170" y1="296" x2="324" y2="296" stroke="#d9e0ec" stroke-width="6" stroke-linecap="round"/>
    <text x="247" y="376" text-anchor="middle" font-family="'Noto Sans CJK JP', 'Hiragino Sans', sans-serif"
          font-weight="700" font-size="76" fill="${PURPLE}">あ</text>
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
