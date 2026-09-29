const { open } = require('./lib.js');

// [貼り付ける文章, 期待する行（店／商品／数量／単価／金額）]
const CASES = [
  ['店の確定売上（値段ちがいが同じ品名の下に並ぶ）', `西川田店
玉ねぎ
　　216円
　　　　2点 421円
　　238円
　　　　3点 702円
計
　　5点 1,123円`, [
    '西川田店/玉ねぎ/2/216/421',
    '西川田店/玉ねぎ/3/238/702',
  ]],

  ['同じ形で品名が変わる', `鹿沼店
なす
　 216円
　　　6点 1,296円
ピーマン
　 162円
　　　12点 1,944円
合計 3,240円`, [
    '鹿沼店/なす/6/216/1296',
    '鹿沼店/ピーマン/12/162/1944',
  ]],

  ['値段ちがいが3段', `鹿沼店
なす
　 216円
　　　2点 432円
　 200円
　　　3点 600円
　 180円
　　　1点 180円
計
　　6点 1,212円`, [
    '鹿沼店/なす/2/216/432',
    '鹿沼店/なす/3/200/600',
    '鹿沼店/なす/1/180/180',
  ]],

  ['1行形式・単位や表記ゆれ', `8/25 鹿沼店
ミニトマト 3個 1134円
キュウリ×2 ¥324
ナス 5ホン 1080円
甘長がらし 4パック @238
ピーマン 6
おはようございます！
ありがとうございました！
合計 1200円`, [
    '鹿沼店/フルトマ/3/378/1134',
    '鹿沼店/きゅうり/2/162/324',
    '鹿沼店/なす/5/216/1080',
    '鹿沼店/甘長/4/238/952',
    '鹿沼店/ピーマン/6/216/1296',
  ]],

  ['かっこ書きは別の商品', `鹿沼店
玉ねぎ（紫） 3点 714円
玉ねぎ 5点 1190円
なす 6点 1,296円（税込）`, [
    '鹿沼店/玉ねぎ（紫）*/3/238/714',
    '鹿沼店/玉ねぎ/5/238/1190',
    '鹿沼店/なす/6/216/1296',
  ]],

  ['未登録の品名は新しい商品の候補に', `鹿沼店
オクラ
　 162円
　　　4点 648円
モロヘイヤ 3点 615円`, [
    '鹿沼店/オクラ*/4/162/648',
    '鹿沼店/モロヘイヤ*/3/205/615',
  ]],
];

(async () => {
  const { b, p, errs } = await open();
  let ng = 0;
  for (const [label, text, expected] of CASES) {
    const rows = await p.evaluate((t) => parseChatText(t, '').map((r) => {
      const prod = db.products.find((x) => x.id === r.productId);
      const name = prod ? prod.name : (r.newProductName || '（なし）') + '*';
      const store = (db.stores.find((x) => x.id === r.storeId) || {}).name || '（なし）';
      return `${store}/${name}/${r.qty}/${r.unitPrice}/${r.total}`;
    }), text);
    const ok = JSON.stringify(rows) === JSON.stringify(expected);
    if (!ok) ng += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    rows.forEach((r, i) => console.log(`     ${r === expected[i] ? ' ' : '→'} ${r}${r === expected[i] ? '' : '   期待 ' + (expected[i] || '（なし）')}`));
    if (rows.length < expected.length) {
      expected.slice(rows.length).forEach((e) => console.log(`     ✗ 出てこなかった: ${e}`));
    }
  }
  console.log(`\n結果: ${CASES.length - ng}/${CASES.length} 件`);
  console.log('ERRORS:', JSON.stringify(errs));
  await b.close();
  process.exit(ng > 0 || errs.length ? 1 : 0);
})();
