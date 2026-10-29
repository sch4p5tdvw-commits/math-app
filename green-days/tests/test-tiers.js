const { open } = require('./lib.js');

// 店のお知らせは税込。登録は税抜。どちらでも正しい段に入ること
const NOTICE = `西川田店
カボチャ
　　356円
　　　　5点 1,780円
　　302円
　　　　3点 906円
　　248円
　　　　2点 496円
　　194円
　　　　4点 776円
計
　　14点 3,958円`;

const ONELINE = `鹿沼店
カボチャ 2点 712円
カボチャ 3点 582円
なす 6点 1,296円`;

(async () => {
  const { b, p, errs, dialogs } = await open();
  let ng = 0;
  const check = (label, got, want) => {
    const ok = String(got) === String(want);
    if (!ok) ng += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}: ${got}${ok ? '' : `   期待 ${want}`}`);
  };

  // ---- 1. 画面から値段ちがいをまとめて登録 ----
  await p.click('.tab-btn[data-screen="stock"]');
  await p.click('#btn-new-product'); await p.waitForTimeout(200);
  check('追加のときは値段を足せる', await p.isVisible('#btn-add-price'), true);
  await p.fill('#product-name', 'カボチャ');
  await p.fill('#product-price', '330');
  // 「＋ 値段ちがいを追加」で欄を増やす。区切り文字は要らない
  for (const v of ['280', '230', '180']) {
    await p.click('#btn-add-price');
    await p.locator('#product-price-rows input').last().fill(v);
  }
  check('値段の欄が4つ', await p.locator('#product-price-rows input').count(), 4);
  await p.click('#product-form button[type="submit"]'); await p.waitForTimeout(500);

  const made = await p.evaluate(() => db.products.filter(x => x.name.includes('カボチャ'))
    .map(x => `${x.name}/¥${x.price}`));
  console.log('\n作られた商品:'); made.forEach(m => console.log('  ', m));
  check('4件できた', made.length, 4);
  check('名前と値段', made.join(' '), 'カボチャ（330円）/¥330 カボチャ（280円）/¥280 カボチャ（230円）/¥230 カボチャ（180円）/¥180');

  // 編集で開いたときは出ないこと
  await p.click('#product-list .list-item'); await p.waitForTimeout(300);
  check('編集のときは値段を足せない', await p.isHidden('#btn-add-price'), true);
  check('編集では値段の欄はひとつ', await p.locator('#product-price-rows input').count(), 1);
  await p.click('#btn-product-cancel'); await p.waitForTimeout(200);

  // ---- 2. 税込のお知らせが、税抜の段に正しく入るか ----
  const rows = await p.evaluate((t) => parseChatText(t, '').map((r) => {
    const prod = db.products.find((x) => x.id === r.productId);
    return `${(prod || {}).name || (r.newProductName || '（なし）') + '*'}/${r.qty}点/@${r.unitPrice}/¥${r.total}`;
  }), NOTICE);
  console.log('\n--- 店のお知らせ（税込）---'); rows.forEach(r => console.log('  ', r));
  check('4段すべて別の商品に入る', rows.join(' '),
    'カボチャ（330円）/5点/@356/¥1780 カボチャ（280円）/3点/@302/¥906 ' +
    'カボチャ（230円）/2点/@248/¥496 カボチャ（180円）/4点/@194/¥776');
  check('新しい商品は作られない', rows.some(r => r.includes('*')), false);

  // ---- 3. 1行形式でも段が選ばれるか ----
  const rows2 = await p.evaluate((t) => parseChatText(t, '').map((r) => {
    const prod = db.products.find((x) => x.id === r.productId);
    return `${(prod || {}).name || (r.newProductName || '（なし）') + '*'}/${r.qty}点/@${r.unitPrice}`;
  }), ONELINE);
  console.log('\n--- 1行形式 ---'); rows2.forEach(r => console.log('  ', r));
  check('712円÷2=356 → 330円の段', rows2[0], 'カボチャ（330円）/2点/@356');
  check('582円÷3=194 → 180円の段', rows2[1], 'カボチャ（180円）/3点/@194');
  check('ほかの商品は変わらない', rows2[2], 'なす/6点/@216');

  // ---- 4. 取込 → 登録 → 出荷の台帳が段ごとに分かれるか ----
  await p.click('.tab-btn[data-screen="sale"]');
  await p.click('#btn-open-import');
  await p.fill('#import-text', NOTICE);
  await p.click('#btn-import-parse'); await p.waitForTimeout(400);
  check('プレビューの件数', await p.textContent('#import-count'), '4');
  check('登録合計（計と一致）', await p.textContent('#import-total'), '¥3,958');
  await p.screenshot({ path: '/tmp/claude-0/-home-user-math-app/858bf2ee-0bfa-5066-9b19-2658095cd592/scratchpad/shot-tiers.png', fullPage: true });
  await p.click('#btn-import-commit'); await p.waitForTimeout(600);

  const sold = await p.evaluate(() => db.sales.map(s => `${s.productName}/${s.qty}点/¥${s.total}`));
  console.log('\n--- 登録された売上 ---'); sold.forEach(s => console.log('  ', s));
  check('売上4件', sold.length, 4);

  // 出荷を段ごとに記録
  await p.click('.tab-btn[data-screen="stock"]');
  await p.click('#btn-open-shipment'); await p.waitForTimeout(400);
  const shipList = await p.evaluate(() => Array.from(
    document.querySelectorAll('#shipment-product-list button')).map(b => b.textContent.trim()));
  console.log('\n出荷で選べる商品:', shipList.join(' | '));
  check('段ごとに出荷先が選べる', shipList.filter(x => x.includes('カボチャ')).length, 4);

  // ---- 4.5 あとから1段だけ足せるか ----
  await p.click('.tab-btn[data-screen="stock"]');
  await p.click('#btn-new-product'); await p.waitForTimeout(200);
  await p.fill('#product-name', 'カボチャ');
  await p.fill('#product-price', '400');
  await p.click('#product-form button[type="submit"]'); await p.waitForTimeout(500);
  const later = await p.evaluate(() => db.products.filter(x => x.name.includes('カボチャ')).map(x => x.name));
  check('1つだけでも段として足される', later.includes('カボチャ（400円）'), true);
  check('ただの「カボチャ」は作られない', later.includes('カボチャ'), false);

  // 段をつけていない品目は、今までどおり1つの商品のまま
  await p.click('#btn-new-product'); await p.waitForTimeout(200);
  await p.fill('#product-name', 'オクラ');
  await p.fill('#product-price', '162');
  await p.click('#product-form button[type="submit"]'); await p.waitForTimeout(500);
  check('段をつけない品目はそのまま',
    await p.evaluate(() => db.products.some(x => x.name === 'オクラ')), true);

  // ---- 4.7 値段のついていない「カボチャ」が残っていても段に入るか ----
  // 取込で先に自動登録されると、こういう商品ができる
  await p.evaluate(() => {
    db.products.push({ id: 'stray', name: 'カボチャ', category: '', aliases: [],
      price: 194, stockByStore: {}, createdAt: Date.now() });
    saveDB();
  });
  const withStray = await p.evaluate((t) => parseChatText(t, '').map((r) => {
    const prod = db.products.find((x) => x.id === r.productId);
    return `${(prod || {}).name || '（なし）'}/@${r.unitPrice}`;
  }), NOTICE);
  console.log('\n--- 値段なしの「カボチャ」が残っている状態 ---');
  withStray.forEach(r => console.log('  ', r));
  check('194円は180円の段に入る（値段なしに吸われない）',
    withStray.join(' '),
    'カボチャ（330円）/@356 カボチャ（280円）/@302 カボチャ（230円）/@248 カボチャ（180円）/@194');

  await p.click('.tab-btn[data-screen="stock"]'); await p.waitForTimeout(300);
  const strayRow = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('#product-list .list-item'))
      .find((x) => x.querySelector('.list-item-title').textContent === 'カボチャ');
    return el ? el.querySelector('.list-item-sub').textContent : null;
  });
  check('一覧で気づける', /値段ちがいの台帳があります/.test(strayRow || ''), true);
  await p.evaluate(() => { db.products = db.products.filter((x) => x.id !== 'stray'); saveDB(); });

  // ---- 5. 集計も段ごとに分かれるか ----
  await p.click('.tab-btn[data-screen="report"]');
  await p.click('#report-range-chips .chip[data-range="all"]'); await p.waitForTimeout(300);
  const report = (await p.textContent('#screen-report')).replace(/\s+/g, ' ');
  check('集計に4段とも出る',
    ['330円', '280円', '230円', '180円'].every(x => report.includes(x)), true);
  check('合計売上', /合計売上 ¥3,958/.test(report), true);

  console.log('\nERRORS:', JSON.stringify(errs));
  await b.close();
  process.exit(ng > 0 || errs.length ? 1 : 0);
})();
