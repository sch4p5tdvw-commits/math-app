const { open } = require('./lib.js');

const TEXT = `西川田店
玉ねぎ
　　216円
　　　　2点 421円
　　238円
　　　　3点 702円
計
　　5点 1,123円`;

(async () => {
  const { b, p, errs, dialogs } = await open();
  let ng = 0;
  const check = (label, got, want) => {
    const ok = String(got) === String(want);
    if (!ok) ng += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}: ${got}${ok ? '' : `   期待 ${want}`}`);
  };

  // ---- 取込 ----
  await p.click('.tab-btn[data-screen="sale"]');
  await p.click('#btn-open-import');
  await p.fill('#import-text', TEXT);
  await p.click('#btn-import-parse'); await p.waitForTimeout(400);

  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('.import-row')).map((el) => {
    const sels = el.querySelectorAll('select');
    const nums = el.querySelectorAll('input[type=number]');
    const diff = el.querySelector('.import-row-diff');
    return {
      src: el.querySelector('.import-src').textContent.replace(/\s+/g, ' ').trim(),
      store: sels[0].selectedOptions[0].textContent,
      product: sels[1].selectedOptions[0].textContent,
      qty: nums[0].value, unit: nums[1].value,
      total: el.querySelector('.import-row-total').textContent.trim(),
      diff: diff ? diff.textContent.trim() : '',
      checked: el.querySelector('input[type=checkbox]').checked,
    };
  }));
  console.log('\n--- 取込プレビュー ---');
  rows.forEach((r, i) => console.log(` ${i + 1}. [${r.checked ? 'x' : ' '}] "${r.src}" => ${r.store} / ${r.product} / ${r.qty}点 @${r.unit} / ${r.total} ${r.diff}`));

  check('行数', rows.length, 2);
  check('1行目', `${rows[0].qty}点@${rows[0].unit} ${rows[0].total} ${rows[0].diff}`, '2点@216 小計 ¥421 値引き -¥11');
  check('2行目', `${rows[1].qty}点@${rows[1].unit} ${rows[1].total} ${rows[1].diff}`, '3点@238 小計 ¥702 値引き -¥12');
  check('店舗がどちらも西川田店', rows.every((r) => r.store === '西川田店'), true);
  check('登録合計（計の1,123円と一致）', await p.textContent('#import-total'), '¥1,123');
  check('件数', await p.textContent('#import-count'), '2');
  await p.screenshot({ path: 'shot-tier.png', fullPage: true });

  // ---- 登録 ----
  const before = await p.evaluate(() => getStock(db.products.find((x) => x.name === '玉ねぎ'), 'st1'));
  await p.click('#btn-import-commit'); await p.waitForTimeout(600);
  console.log('\n確認ダイアログ:', JSON.stringify(dialogs[dialogs.length - 1]));

  const after = await p.evaluate(() => ({
    sales: db.sales.map((s) => `${s.storeName}/${s.productName}/${s.qty}点/@${s.unitPrice}/¥${s.total}`),
    stock: getStock(db.products.find((x) => x.name === '玉ねぎ'), 'st1'),
    products: db.products.length,
  }));
  console.log('\n--- 登録後 ---');
  after.sales.forEach((s) => console.log('  ', s));
  check('売上2件', after.sales.length, 2);
  check('在庫が5点引かれた', `${before} -> ${after.stock}`, `${before} -> ${before - 5}`);
  check('商品は増えていない', after.products, 6);

  // ---- 集計 ----
  await p.click('.tab-btn[data-screen="report"]');
  await p.click('#report-range-chips .chip[data-range="all"]'); await p.waitForTimeout(300);
  const report = (await p.textContent('#screen-report')).replace(/\s+/g, ' ');
  check('集計の合計売上', /合計売上 ¥1,123/.test(report), true);
  check('集計の販売数', /合計販売数 5/.test(report), true);

  // ---- 履歴 ----
  await p.click('.tab-btn[data-screen="history"]'); await p.waitForTimeout(300);
  check('履歴の件数', await p.textContent('#history-count'), '2');

  // 履歴から1件直して、在庫が合うか
  await p.click('#history-list .list-item .list-item-main'); await p.waitForTimeout(400);
  check('修正画面が開く', await p.textContent('#record-edit-title'), '売上を修正');
  // 先頭に出ている行を4点に直す。残るもう1件と、在庫の動きを突き合わせる
  const wasQty = Number(await p.inputValue('#record-edit-qty'));
  const other = 5 - wasQty;
  await p.fill('#record-edit-qty', '4'); await p.waitForTimeout(250);
  await p.click('#record-edit-form button[type="submit"]'); await p.waitForTimeout(500);
  const edited = await p.evaluate(() => ({
    stock: getStock(db.products.find((x) => x.name === '玉ねぎ'), 'st1'),
    qtys: [...db.sales].map((s) => s.qty).sort((a, c) => a - c).join(','),
  }));
  check('数量を直すと在庫も合う',
    `${edited.qtys} / 在庫${edited.stock}`,
    `${[other, 4].sort((a, c) => a - c).join(',')} / 在庫${before - other - 4}`);

  console.log('\nERRORS:', JSON.stringify(errs));
  await b.close();
  process.exit(ng > 0 || errs.length ? 1 : 0);
})();
