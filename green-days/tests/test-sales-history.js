const { open } = require('./lib.js');

// 売上の履歴も、出荷と同じ「日付 → 店舗 → 品目」の形で見えること
const TEXT_7 = `鹿沼店
なす 5点 1080円
玉ねぎ 3点 714円
西川田店
なす 2点 421円`;

const TEXT_6 = `鹿沼店
きゅうり 4点 648円`;

(async () => {
  const { b, p, errs } = await open();
  let ng = 0;
  const check = (label, got, want) => {
    const ok = String(got) === String(want);
    if (!ok) ng += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}: ${got}${ok ? '' : '   期待 ' + want}`);
  };
  const SHOTS = '/tmp/claude-0/-home-user-math-app/858bf2ee-0bfa-5066-9b19-2658095cd592/scratchpad';

  const importSales = async (text, date) => {
    await p.click('.tab-btn[data-screen="sale"]');
    await p.click('#btn-open-import');
    await p.fill('#import-text', text);
    await p.click('#btn-import-parse');
    await p.waitForTimeout(400);
    const n = await p.locator('.import-row input[type=date]').count();
    for (let i = 0; i < n; i += 1) {
      await p.locator('.import-row input[type=date]').nth(i).fill(date);
    }
    await p.waitForTimeout(200);
    await p.click('#btn-import-commit');
    await p.waitForTimeout(600);
  };

  await importSales(TEXT_7, '2026-11-07');
  await importSales(TEXT_6, '2026-11-06');

  await p.click('.tab-btn[data-screen="history"]');
  await p.waitForTimeout(400);
  check('はじめは売上が出ている', await p.textContent('#history-title'), '売上の履歴');

  const read = () => p.evaluate(() => Array.from(document.querySelectorAll('.ship-day')).map((d) => ({
    date: d.querySelector('.ship-day-date').textContent,
    sum: d.querySelector('.ship-day-sum').textContent,
    stores: Array.from(d.querySelectorAll('.ship-day-store')).map((st) => ({
      head: st.querySelector('.ship-day-store-head span:first-child').textContent,
      sum: st.querySelector('.ship-day-store-sum').textContent,
      items: Array.from(st.querySelectorAll('.list-item')).map((li) =>
        li.querySelector('.list-item-title').textContent + ' | ' +
        li.querySelector('.list-item-value').textContent + ' | ' +
        li.querySelector('.list-item-sub').textContent),
    })),
  })));

  const view = await read();
  console.log('\n--- 売上の履歴 ---');
  view.forEach((d) => {
    console.log(`  ■ ${d.date}   ${d.sum}`);
    d.stores.forEach((st) => {
      console.log(`      ${st.head}  ${st.sum}`);
      st.items.forEach((i) => console.log(`         ${i}`));
    });
  });
  await p.screenshot({ path: SHOTS + '/shot-sales-history.png', fullPage: true });

  check('日付のかたまりが2つ', view.length, 2);
  check('新しい日が上', view[0].date, '11月7日（土）');
  // なす5点¥1080 + 玉ねぎ3点¥714 + なす2点¥421 = 10点 ¥2,215
  check('11/7の合計', view[0].sum, '10点・¥2,215');
  check('11/7は2店舗', view[0].stores.length, 2);
  check('鹿沼店の小計', view[0].stores.find((s) => s.head === '鹿沼店').sum, '8点・¥1,794');
  check('西川田店の小計', view[0].stores.find((s) => s.head === '西川田店').sum, '2点・¥421');
  check('11/6の合計', view[1].sum, '4点・¥648');
  check('店舗名を品目行に重ねない',
    view[0].stores[0].items.every((i) => !i.includes('鹿沼店')), true);
  check('品目行は 金額 / 点数・単価',
    view[0].stores.find((s) => s.head === '鹿沼店').items.some((i) => i.startsWith('なす | ¥1,080 | 5点・@¥216')), true);
  // 2点421円は 216×2=432 より11円安い
  check('値引きが分かる',
    view[0].stores.find((s) => s.head === '西川田店').items[0], 'なす | ¥421 | 2点・@¥216・値引き -¥11');

  // 店舗でしぼる
  await p.locator('#history-store-chips .chip').nth(1).click();
  await p.waitForTimeout(400);
  const filtered = await p.evaluate(() => Array.from(
    document.querySelectorAll('.ship-day-store-head span:first-child')).map((x) => x.textContent));
  check('しぼり込みが効く', [...new Set(filtered)].join(','), '鹿沼店');
  await p.locator('#history-store-chips .chip').nth(0).click();
  await p.waitForTimeout(300);

  // 出荷に切り替えても同じ形
  await p.click('#history-kind-chips .chip[data-kind="restocks"]');
  await p.waitForTimeout(400);
  check('出荷に切り替わる', await p.textContent('#history-title'), '出荷の履歴');
  check('出荷は記録なし', await p.textContent('#history-list'), '出荷の記録がありません');
  await p.click('#history-kind-chips .chip[data-kind="sales"]');
  await p.waitForTimeout(400);

  // 1件消すと、その日の合計も合う
  const target = await p.evaluate(() => {
    const li = document.querySelector('.ship-day .list-item');
    return Number(li.querySelector('.list-item-value').textContent.replace(/[^\d]/g, ''));
  });
  await p.click('.ship-day .list-item .list-item-del');
  await p.waitForTimeout(500);
  const after = await read();
  console.log(`\n¥${target} を削除 →`, after[0].date, after[0].sum);
  check('消した分だけ合計が減る', after[0].sum.split('・')[1],
    '¥' + (2215 - target).toLocaleString('ja-JP'));

  // タップすると修正画面
  await p.click('.ship-day .list-item .list-item-main');
  await p.waitForTimeout(400);
  check('タップで修正画面', await p.textContent('#record-edit-title'), '売上を修正');

  console.log('\nERRORS:', JSON.stringify(errs));
  await b.close();
  process.exit(ng > 0 || errs.length ? 1 : 0);
})();
