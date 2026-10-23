// 画面を通して、登録・CSV・3つの出題・間隔反復・記録・オフラインを一周する。
//
//   cd eitango && python3 -m http.server 8822 &
//   cd tests && node test-app.js
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const URL = "http://localhost:8822/index.html";
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || detail === undefined ? "" : "  → " + detail}`);
  if (!ok) failed++;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eitango-"));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });

  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const en = () => p.evaluate(() => currentWord().en);
  // アプリのキーボードのキーを1つずつ押して書く
  async function tapKeys(text) {
    for (const c of text) await p.click(`.kb-key[data-key="${c === " " ? "space" : c}"]`);
  }

  // --- 採点 ---
  const grading = await p.evaluate(() => [
    isCorrectAnswer("Look  For.", "look for"),
    isCorrectAnswer("ｌｏｏｋ　ｆｏｒ", "look for"),
    isCorrectAnswer("dont", "don't"),
    isCorrectAnswer("don’t", "don't"),
    isCorrectAnswer("colour", "color / colour"),
    isCorrectAnswer("afraid of", "(be) afraid of"),
    isCorrectAnswer("be afraid of", "(be) afraid of"),
    isCorrectAnswer("", "apple"),
  ]);
  const be = await p.evaluate(() => [
    displayEn("be good at"),
    displayEn("(be) afraid of"),
    displayEn("be good at / be poor at"),
    displayEn("because of"),
    displayEn("let it be"),
    storeEn("be動詞 good at"),
    isCorrectAnswer("be good at", "be good at"),
    isCorrectAnswer("be動詞 good at", "be good at"),
    isCorrectAnswer("is good at", "be good at"),
    isCorrectAnswer("good at", "be good at"),
    hintFor("be good at"),
  ]);
  check("be動詞の表記", JSON.stringify(be) === JSON.stringify([
    "be動詞 good at", "(be動詞) afraid of", "be動詞 good at / be動詞 poor at", "because of", "let it be",
    "be good at", true, true, true, false, "be動詞　 g _ _ _　 a _",
  ]), JSON.stringify(be));
  check("採点のゆれ", JSON.stringify(grading) === JSON.stringify([true, true, false, true, true, true, true, false]), grading);

  // --- 単語の追加・編集・削除 ---
  check("サンプル10語", (await p.textContent("#home-total")) === "10");
  await p.click('.tab[data-view="words"]');
  await p.click("#words-add");
  await p.fill("#edit-en", "make friends");
  await p.fill("#edit-ja", "友だちになる");
  check("スペース入りは熟語になる", await p.evaluate(() => editType === "idiom"));
  await p.click('#edit-form button[type="submit"]');
  await p.fill("#edit-en", "be動詞 fond of");
  await p.fill("#edit-ja", "～が好きだ");
  await p.click('#edit-form button[type="submit"]');
  check("be動詞と入力しても be で保存", await p.evaluate(() => db.words.some((w) => w.en === "be fond of")));
  await p.fill("#edit-en", "be good at");
  await p.fill("#edit-ja", "x");
  await p.click('#edit-form button[type="submit"]');
  check("be動詞の熟語も重複を見つける", (await p.textContent("#edit-warn")).includes("「be動詞 good at」はもう登録"),
    await p.textContent("#edit-warn"));
  await p.fill("#edit-en", "APPLE");
  await p.fill("#edit-ja", "x");
  await p.click('#edit-form button[type="submit"]');
  check("同じ英語は登録しない", (await p.textContent("#edit-warn")).includes("もう登録"));
  await p.click("#edit-cancel");
  check("追加で12件", (await p.textContent("#words-count")) === "12 件");
  await p.fill("#words-search", "be動詞 fond");
  check("単語帳は be動詞 と表示", (await p.textContent(".word-en")) === "be動詞 fond of");
  await p.click(".word-main");
  check("編集画面も be動詞 と表示", (await p.inputValue("#edit-en")) === "be動詞 fond of");
  await p.click("#edit-delete");
  await p.fill("#words-search", "友だち");
  await p.click(".word-main");
  await p.fill("#edit-ja", "友達になる");
  await p.click('#edit-form button[type="submit"]');
  await p.fill("#words-search", "");
  check("編集", await p.evaluate(() => db.words.some((w) => w.ja === "友達になる")));
  await p.fill("#words-search", "make");
  await p.click(".word-main");
  await p.click("#edit-delete");
  check("削除", await p.evaluate(() => db.words.length === 10));
  await p.fill("#words-search", "");

  // --- CSV ---
  const csv = path.join(tmp, "in.csv");
  fs.writeFileSync(csv, '英語,日本語訳,種類,例文\r\nbe interested in,～に興味がある,熟語,"I like music, art and ""manga""."\r\nquickly,速く,,\r\n,空,単語,\r\n');
  await p.click('.tab[data-view="settings"]');
  await p.setInputFiles("#csv-file", csv);
  await p.waitForTimeout(200);
  check("CSV読み込み", (await p.textContent("#csv-result")).includes("追加 2件") && (await p.textContent("#csv-result")).includes("4行目"),
    await p.textContent("#csv-result"));
  check("CSVの引用符", await p.evaluate(() => db.words.find((w) => w.en === "be interested in").example === 'I like music, art and "manga".'));
  const sjis = path.join(tmp, "sj.csv");
  // "teacher,先生,単語" を Shift_JIS で
  fs.writeFileSync(sjis, Buffer.concat([Buffer.from("teacher,"), Buffer.from([0x90, 0xe6, 0x90, 0xb6]), Buffer.from(","), Buffer.from([0x92, 0x50, 0x8c, 0xea]), Buffer.from("\r\n")]));
  await p.setInputFiles("#csv-file", sjis);
  await p.waitForTimeout(200);
  check("Shift_JISのCSV", await p.evaluate(() => db.words.some((w) => w.en === "teacher" && w.ja === "先生" && w.type === "word")));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#csv-export")]);
  const out = fs.readFileSync(await dl.path());
  check("CSV書き出し（BOMつき）", out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf && out.toString().includes("teacher,先生,単語"));
  // 練習はサンプルの10語だけで行う
  await p.evaluate(() => { db.words = db.words.slice(0, 10); saveDB(); });

  // --- カードめくり（今日の分）---
  await p.click('.tab[data-view="home"]');
  check("今日の分は新しい10語", (await p.textContent("#today-line")).includes("新しい単語 10語"));
  await p.click('[data-mode="cards"]');
  check("カードの英語を表示", (await p.textContent("#fc-en")).length > 0);
  // 最後の1枚で「知らない」を押しつづけても、先へ進んでおわれること
  let seenBe = false;
  for (let i = 0; i < 30 && (await p.isVisible("#view-study")); i++) {
    await p.click("#flashcard", { position: { x: 30, y: 60 } });
    const word = await en();
    if (word === "be good at") seenBe = (await p.textContent("#fc-en")) === "be動詞 good at";
    const last = (await p.evaluate(() => session.queue.length)) === 1;
    if (word === "apple" || last) {
      const before = await p.textContent("#study-progress");
      await p.click("#ans-unknown");
      if (await p.isVisible("#view-study")) {
        check("知らないで次へ進む", (await p.textContent("#study-progress")) !== before, before);
      }
    } else {
      await p.click("#ans-known");
    }
  }
  check("カードに be動詞 と表示", seenBe);
  check("カードめくり完了", (await p.textContent("#done-summary")).includes("10語のうち、知ってたのは 8語"), await p.textContent("#done-summary"));
  check("知らなかった単語の一覧", (await p.textContent("#done-missed-list")).includes("apple"));
  const apple = await p.evaluate(() => db.words.find((w) => w.en === "apple"));
  check("知らなかった単語は苦手になる", apple.lapses === 1 && apple.level === 0, JSON.stringify(apple));
  await p.click("#done-home");
  check("今日の学習 10", (await p.textContent("#stat-today")) === "10");
  check("連続 1日", (await p.textContent("#stat-streak")) === "1");
  check("2回とも知らなかった単語は今日の分に残る", (await p.textContent("#today-line")).includes("復習 2語"),
    await p.textContent("#today-line"));
  // 残りを片づける
  await p.click('[data-mode="cards"]');
  for (let i = 0; i < 10 && (await p.isVisible("#view-study")); i++) {
    await p.click("#flashcard", { position: { x: 30, y: 60 } });
    await p.click("#ans-known");
  }
  await p.click("#done-home");
  check("目標クリア", (await p.textContent("#today-line")).includes("クリア"));
  dialogs.length = 0;
  await p.click('[data-mode="cards"]');
  check("今日の分がないと知らせる", dialogs.length === 1 && dialogs[0].includes("おわって"));

  // --- 日 → 英（苦手だけ）---
  await p.click('[data-scope="weak"]');
  await p.click('[data-mode="ja2en"]');
  const weak = await p.evaluate(() => session.queue.map((id) => db.words.find((w) => w.id === id).en));
  check("苦手だけ = 知らなかった2語", weak.length === 2 && weak.includes("apple"), weak.join(","));
  const target = await en();
  check("アプリのキーボードを出す", await p.isVisible("#je-form .kb"));
  check("端末のキーボードは出さない",
    (await p.evaluate(() => $("je-input").readOnly)) && (await p.getAttribute("#je-input", "inputmode")) === "none");
  await tapKeys("ab c");
  await p.click('.kb-key[data-key="back"]');
  check("キーで書いて⌫で消せる", (await p.inputValue("#je-input")) === "ab ");
  await p.click('.kb-key[data-key="space"]');
  check("空白は続けて入らない", (await p.inputValue("#je-input")) === "ab ");
  await p.keyboard.press("Backspace");
  await p.keyboard.type("Xy");
  check("パソコンのキーボードでも書ける", (await p.inputValue("#je-input")) === "abxy");
  for (let i = 0; i < 4; i++) await p.click('.kb-key[data-key="back"]');

  // 端末のキーボードにしたとき
  await p.evaluate(() => { db.settings.appKeyboard = false; applyKeyboardMode(); });
  check("設定で端末のキーボード（英字）にできる",
    (await p.isHidden("#je-form .kb")) && (await p.getAttribute("#je-input", "inputmode")) === "email");
  await p.fill("#je-input", "あっぷる");
  await p.press("#je-input", "Enter");
  check("かなは採点せずに知らせる", (await p.isVisible("#je-warn")) && (await p.isHidden("#je-feedback")));
  await p.fill("#je-input", "");
  check("入力し直すと注意が消える", await p.isHidden("#je-warn"));
  await p.evaluate(() => { db.settings.appKeyboard = true; applyKeyboardMode(); });

  await p.click("#je-hint-btn");
  check("ヒント", (await p.textContent("#je-hint")) === (await p.evaluate((e) => hintFor(e), target)));
  await tapKeys(target + "x");
  await p.keyboard.press("Enter");
  check("つづりちがいは不正解", (await p.textContent("#je-feedback .fb-mark")).includes("ざんねん"));
  await p.click('#je-feedback [data-act="override"]');
  check("正解にする", (await p.textContent("#je-feedback .fb-mark")).includes("正解"));
  await p.click('#je-feedback [data-act="next"]');
  check("予定より早い正解ではレベルを上げない", await p.evaluate((e) => db.words.find((w) => w.en === e).level === 1, target));
  await p.click("#study-quit");

  // --- 英 → 日（全部）---
  await p.click('[data-scope="all"]');
  await p.click('[data-mode="en2ja"]');
  check("英語はかくしてある", await p.isHidden("#ej-en"));
  let word = await en();
  check("英→日もアプリのキーボード", await p.isVisible("#ej-form .kb"));
  await tapKeys(word);
  await p.click('#ej-form button[type="submit"]');
  check("つづり正解", (await p.textContent("#ej-spell")).includes("正解"));
  check("4択", (await p.locator(".choice").count()) === 4);
  await p.click('.choice:not([data-correct="1"])');
  check("意味をまちがえると不正解", (await p.textContent("#ej-feedback .fb-mark")).includes("ざんねん"));
  await p.click('#ej-feedback [data-act="next"]');
  await p.click("#ej-giveup");
  check("わからない → 英語を見せる", await p.isVisible("#ej-en"));
  await p.click('.choice[data-correct="1"]');
  check("つづりをあきらめると不正解", (await p.textContent("#ej-feedback .fb-mark")).includes("ざんねん"));
  await p.click("#study-quit");

  // --- 翌日：まちがえた単語が先頭 ---
  await p.evaluate(() => {
    const D = Date;
    const off = 86400000;
    window.Date = class extends D {
      constructor(...a) { if (a.length) super(...a); else super(D.now() + off); }
      static now() { return D.now() + off; }
    };
    renderHome();
  });
  const order = await p.evaluate(() => todayQueue().review.map((w) => w.en));
  const lapsed = await p.evaluate(() => db.words.filter((w) => w.lapses > 0).map((w) => w.en));
  check("翌日は苦手な単語から復習", lapsed.every((e) => order.indexOf(e) < lapsed.length), order.join(","));
  check("翌日の連続日数", (await p.textContent("#streak-note")).includes("2日連続"));

  // --- 目標 ---
  await p.click('.tab[data-view="settings"]');
  await p.click("#goal-plus");
  check("目標を変える", await p.evaluate(() => db.settings.newPerDay === 11));

  // --- オフライン ---
  await p.goto(URL);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await ctx.setOffline(true);
  await p.reload();
  check("オフラインで開ける", (await p.textContent(".topbar-title")) === "英単語ノート");
  await ctx.setOffline(false);

  check("エラーなし", errs.length === 0, errs.join(" / "));
  await b.close();
  console.log(failed ? `\n${failed} 件 NG` : "\nすべて ok");
  process.exit(failed ? 1 : 0);
})();
