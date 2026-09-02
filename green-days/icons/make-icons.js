// アイコンを作り直すためのもの。ふだんは動かさなくてよい。
//
//   cd green-days/icons && node make-icons.js
//
// Playwright（Chromium）で SVG を描いて PNG に落としている。手で PNG を
// 描き直すと 3 サイズがずれるので、必ずここから作る。
const { chromium } = require("playwright");

const RED = "#e0523f";
const RED_DARK = "#c4442f";
const LEAF = "#9ccc65";
const STEM = "#7cb342";
const GREEN = "#2e7d32";

// 緑地に白い棒グラフ。右上はトマト。背景が緑なので、ヘタを濃い緑にすると
// 沈んでしまう。明るい黄緑にして輪郭を出している。
const APP_ICON = `
  <rect width="512" height="512" fill="${GREEN}"/>
  <rect x="100" y="256" width="66" height="144" fill="#fff"/>
  <rect x="199" y="174" width="66" height="226" fill="#fff"/>
  <rect x="295" y="88" width="66" height="312" fill="#fff"/>
  <g transform="translate(392 166)">
    <circle cx="0" cy="0" r="66" fill="${RED}"/>
    <path d="M-66 0 A66 66 0 0 0 66 0 Z" fill="${RED_DARK}" opacity="0.16"/>
    <ellipse cx="-24" cy="-26" rx="16" ry="11" fill="#fff" opacity="0.3" transform="rotate(-30 -24 -26)"/>
    <path d="M0 -60 L0 -84" stroke="${STEM}" stroke-width="12" stroke-linecap="round"/>
    <path d="M0 -62 L-42 -76 M0 -62 L42 -76 M0 -62 L-30 -44 M0 -62 L30 -44"
          stroke="${LEAF}" stroke-width="16" stroke-linecap="round"/>
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
