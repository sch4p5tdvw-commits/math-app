const { open } = require('./lib.js');

(async () => {
  const { b, p, errs } = await open();
  let ng = 0;
  const check = (label, got, want) => {
    const ok = String(got) === String(want);
    if (!ok) ng += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}: ${got}${ok ? '' : '   期待 ' + want}`);
  };
  const SHOTS = '/tmp/claude-0/-home-user-math-app/858bf2ee-0bfa-5066-9b19-2658095cd592/scratchpad';

  const ship = async (productName, perStore, date) => {
    await p.click('.tab-btn[data-screen="stock"]');
    await p.click('#btn-open-shipment');
    await p.waitForTimeout(300);
    await p.evaluate((n) => {
      const btn = Array.from(document.querySelectorAll('#shipment-product-list button'))
        .find((x) => x.querySelector('.ship-product-name').textContent === n);
      btn.click();
    }, productName);
    await p.waitForTimeout(300);
    if (date) {
      await p.fill('#shipment-date', date);
      await p.waitForTimeout(200);
    }
    for (const [storeName, qty] of Object.entries(perStore)) {
      await p.evaluate((arg) => {
        const row = Array.from(document.querySelectorAll('#shipment-store-rows .ship-store'))
          .find((r) => r.querySelector('.ship-store-name').textContent === arg.s);
        Array.from(row.querySelectorAll('.ship-chip'))
          .find((c) => c.dataset.value === String(arg.q)).click();
      }, { s: storeName, q: qty });
      await p.waitForTimeout(120);
    }
    return {
      thisProduct: await p.textContent('#shipment-total'),
      dayLabel: await p.textContent('#shipment-day-label'),
      dayTotal: await p.textContent('#shipment-day-total'),
    };
  };

  // ---- 1. 入力中に、この商品とその日の合計が出るか ----
  // なす¥216 を 鹿沼5 + 西川田3 = 8点 ¥1,728
  let t = await ship('なす', { 鹿沼店: 5, 西川田店: 3 }, '2026-11-07');
  console.log('\n--- 1件目を入力中 ---');
  console.log('  この商品:', t.thisProduct, '/', t.dayLabel + ':', t.dayTotal);
  check('この商品の点数と金額', t.thisProduct, '8点・¥1,728');
  check('日付の見出し', t.dayLabel, '11月7日（土）の出荷');
  check('その日の合計', t.dayTotal, '8点・¥1,728');
  await p.screenshot({ path: SHOTS + '/shot-ship-input.png', fullPage: true });
  await p.click('#btn-shipment-commit');
  await p.waitForTimeout(500);

  // ---- 2. 続けて別の商品を出すと、その日の合計が積み上がるか ----
  // 玉ねぎ¥238 を 鹿沼10 = 10点 ¥2,380 → その日は 18点 ¥4,108
  t = await ship('玉ねぎ', { 鹿沼店: 10 }, '2026-11-07');
  console.log('\n--- 2件目を入力中 ---');
  console.log('  この商品:', t.thisProduct, '/', t.dayLabel + ':', t.dayTotal);
  check('この商品', t.thisProduct, '10点・¥2,380');
  check('その日の合計が積み上がる', t.dayTotal, '18点・¥4,108');
  await p.click('#btn-shipment-commit');
  await p.waitForTimeout(500);

  // 別の日は別勘定
  t = await ship('きゅうり', { 西川田店: 4 }, '2026-11-06');
  check('別の日は別に数える', t.dayTotal, '4点・¥648');
  check('別の日の見出し', t.dayLabel, '11月6日（金）の出荷');
  await p.click('#btn-shipment-commit');
  await p.waitForTimeout(500);

  // ---- 3. 出荷したときの値段が記録に残るか ----
  const saved = await p.evaluate(() => db.restocks.map(
    (r) => `${r.date}/${r.storeName}/${r.productName}/${r.qty}点/@${r.unitPrice}`));
  console.log('\n--- 記録 ---');
  saved.forEach((x) => console.log('  ', x));
  check('出荷時の単価が残る', saved.every((x) => !/@undefined/.test(x)), true);

  // あとで値段を変えても、過去の出荷額は動かないこと
  await p.evaluate(() => {
    db.products.find((x) => x.name === 'なす').price = 999;
    saveDB();
  });

  // ---- 4. 履歴が日付ごと・店舗ごとに出るか ----
  await p.click('.tab-btn[data-screen="history"]');
  await p.waitForTimeout(300);
  await p.click('#history-kind-chips .chip[data-kind="restocks"]');
  await p.waitForTimeout(400);

  const view = await p.evaluate(() => Array.from(document.querySelectorAll('.ship-day')).map((d) => ({
    date: d.querySelector('.ship-day-date').textContent,
    sum: d.querySelector('.ship-day-sum').textContent,
    stores: Array.from(d.querySelectorAll('.ship-day-store')).map((st) => ({
      head: st.querySelector('.ship-day-store-head span:first-child').textContent,
      sum: st.querySelector('.ship-day-store-sum').textContent,
      items: Array.from(st.querySelectorAll('.list-item')).map((li) =>
        li.querySelector('.list-item-title').textContent + ' ' +
        li.querySelector('.list-item-value').textContent + ' ' +
        li.querySelector('.list-item-sub').textContent),
    })),
  })));
  console.log('\n--- 出荷の履歴 ---');
  view.forEach((d) => {
    console.log(`  ■ ${d.date}   ${d.sum}`);
    d.stores.forEach((st) => {
      console.log(`      ${st.head}  ${st.sum}`);
      st.items.forEach((i) => console.log(`         ${i}`));
    });
  });
  await p.screenshot({ path: SHOTS + '/shot-ship-history.png', fullPage: true });

  check('日付のかたまりが2つ', view.length, 2);
  check('新しい日が上', view[0].date, '11月7日（土）');
  check('11/7の合計', view[0].sum, '18点・¥4,108');
  check('11/7は2店舗', view[0].stores.length, 2);
  check('鹿沼店の小計', view[0].stores.find((s) => s.head === '鹿沼店').sum, '15点・¥3,460');
  check('西川田店の小計', view[0].stores.find((s) => s.head === '西川田店').sum, '3点・¥648');
  check('11/6の合計', view[1].sum, '4点・¥648');
  check('店舗名を品目行に重ねない',
    view[0].stores[0].items.every((i) => !i.includes('鹿沼店')), true);

  // 店舗でしぼる
  // チップは押すたびに作り直されるので、そのつど引き直す
  await p.locator('#history-store-chips .chip').nth(1).click();
  await p.waitForTimeout(400);
  const filtered = await p.evaluate(() => Array.from(
    document.querySelectorAll('.ship-day-store-head span:first-child')).map((x) => x.textContent));
  check('しぼり込みが効く', [...new Set(filtered)].join(','), '鹿沼店');
  await p.locator('#history-store-chips .chip').nth(0).click();
  await p.waitForTimeout(300);

  // ---- 5. 1件消すと、その日の合計も合うか ----
  // 先頭に出ている行を消し、その行の分だけ減ることを確かめる
  const target = await p.evaluate(() => {
    const li = document.querySelector('.ship-day .list-item');
    return {
      qty: Number(li.querySelector('.list-item-value').textContent.replace(/[^\d]/g, '')),
      amount: Number(li.querySelector('.list-item-sub').textContent.replace(/[^\d]/g, '')),
    };
  });
  await p.click('.ship-day .list-item .list-item-del');
  await p.waitForTimeout(500);
  const afterDel = await p.evaluate(() => {
    const d = document.querySelector('.ship-day');
    return { date: d.querySelector('.ship-day-date').textContent, sum: d.querySelector('.ship-day-sum').textContent };
  });
  console.log(`\n${target.qty}点・¥${target.amount} を削除 →`, afterDel.date, afterDel.sum);
  check('消した分だけ合計が減る', afterDel.sum,
    `${18 - target.qty}点・${'¥' + (4108 - target.amount).toLocaleString('ja-JP')}`);

  console.log('\nERRORS:', JSON.stringify(errs));
  await b.close();
  process.exit(ng > 0 || errs.length ? 1 : 0);
})();
