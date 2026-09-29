const { chromium } = require('playwright');
const seed = require('./seed.js');

async function open() {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.goto('http://localhost:8811/index.html');
  await p.waitForTimeout(400);
  await p.evaluate((s) => {
    db.stores = s.stores.map((name, i) => ({ id: 'st' + i, name, createdAt: Date.now() }));
    db.products = s.products.map((x, i) => ({
      id: 'pr' + i, name: x.name, category: '', aliases: x.aliases,
      price: x.price, stockByStore: { st0: 10, st1: 10 }, createdAt: Date.now(),
    }));
    db.sales = []; db.restocks = [];
    saveDB();
  }, seed);
  await p.reload();
  await p.waitForTimeout(400);
  return { b, p, errs, dialogs };
}
module.exports = { open };
