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
  check("4択は意味が合えば正解と表示", (await p.textContent("#ej-feedback .fb-mark")).includes("意味は正解")
    && (await p.isVisible("#ej-feedback .fb-note")));
  check("つづりをあきらめた単語は記録では不正解", await p.evaluate(() => session.pending === false));
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

  // --- 効果音・同じ意味の単語・例文 ---
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  // 前の版で保存したサンプル（例文の訳がない）を開いたとき
  await p.evaluate(() => { for (const w of db.words) delete w.exampleJa; saveDB(); });
  await p.reload();
  check("前からあるサンプルにも例文の訳が入る",
    await p.evaluate(() => db.words.find((w) => w.en === "a lot of").exampleJa === "私の部屋にはたくさんの本があります。"));
  await p.evaluate(() => {
    window.__sfx = [];
    const play = Sfx.play.bind(Sfx);
    Sfx.play = (k) => { window.__sfx.push(k); return play(k); };
    db.words.push(makeWord("many", "（数えられる）たくさんの", "word", "I have many friends.", "私には友だちがたくさんいます。"));
    saveDB();
  });
  const startWith = (mode, en) => p.evaluate(([mode, en]) => {
    scope = "all";
    startSession(mode);
    session.queue = [db.words.find((w) => w.en === en).id];
    session.total = session.words = 1;
    nextItem();
  }, [mode, en]);
  const sfx = () => p.evaluate(() => window.__sfx.splice(0).join(","));

  await startWith("ja2en", "a lot of");
  await tapKeys("many");
  await p.keyboard.press("Enter");
  check("同じ意味の別の単語は書き直し", (await p.isVisible("#je-alt")) && (await p.isHidden("#je-feedback"))
    && (await p.textContent("#je-alt")).includes("many"));
  check("書き直しのときは音を鳴らさない", (await sfx()) === "");
  await tapKeys("a lot of");
  await p.keyboard.press("Enter");
  check("正解でピンポン", (await sfx()) === "correct");
  check("答え合わせのあとに例文", await p.isVisible("#je-feedback .example"));
  check("例文の訳ははじめ隠す", await p.isHidden("#je-feedback .ex-ja"));
  await p.click("#je-feedback .example");
  check("例文をタップすると訳", (await p.isVisible("#je-feedback .ex-ja"))
    && (await p.textContent("#je-feedback .ex-ja")) === "私の部屋にはたくさんの本があります。");
  await p.click('#je-feedback [data-act="next"]');
  await p.click("#done-home");

  await startWith("ja2en", "apple");
  await tapKeys("aple");
  await p.keyboard.press("Enter");
  check("不正解でブブー", (await sfx()) === "wrong");
  await p.click('#je-feedback [data-act="override"]');
  check("正解にするとピンポン", (await sfx()) === "correct");
  await p.click("#study-quit");

  await startWith("en2ja", "apple");
  await tapKeys("aple");
  await p.click('#ej-form button[type="submit"]');
  check("つづりをまちがえるとブブー", (await sfx()) === "wrong");
  await p.click('.choice[data-correct="1"]');
  check("つづりをまちがえても意味が合えばピンポン", (await sfx()) === "correct");
  await p.click('#ej-feedback [data-act="next"]');
  check("つづりをまちがえた単語は苦手に入る", await p.evaluate(() => isWeak(db.words.find((w) => w.en === "apple"))));
  await p.click("#study-quit");

  await startWith("cards", "look for");
  check("カードの表に例文を出さない", await p.isHidden("#flashcard .example"));
  await p.click("#flashcard", { position: { x: 30, y: 60 } });
  check("カードの裏に例文", await p.isVisible("#flashcard .example"));
  await p.click("#flashcard .example");
  check("裏の例文をタップしてもカードはそのまま", (await p.isVisible("#flashcard .ex-ja")) && (await p.isVisible("#answer-buttons")));
  await p.click("#study-quit");

  await startWith("en2ja", "a lot of");
  await tapKeys("a lot of");
  await p.click('#ej-form button[type="submit"]');
  check("つづり正解でピンポン", (await sfx()) === "correct");
  check("意味を選ぶ前に例文を出さない", (await p.locator("#mode-en2ja .example:visible").count()) === 0);
  const choicesOk = await p.evaluate(() => {
    const w = db.words.find((x) => x.en === "a lot of");
    for (let i = 0; i < 50; i++) if (makeChoices(w, db.words).some((c) => c.en === "many")) return false;
    return true;
  });
  check("同じ意味の訳は4択に入れない", choicesOk);
  await p.click('.choice:not([data-correct="1"])');
  check("意味をまちがえるとブブー", (await sfx()) === "wrong");
  check("つづりが合って意味をまちがえると不正解", (await p.textContent("#ej-feedback .fb-mark")).includes("ざんねん")
    && (await p.isHidden("#ej-feedback .fb-note")));
  check("答え合わせのあとに例文（英→日）", await p.isVisible("#ej-feedback .example"));
  await p.click("#study-quit");

  await p.click('.tab[data-view="settings"]');
  await p.click("#set-sfx");
  check("効果音を消せる", await p.evaluate(() => db.settings.sfx === false && Sfx.play("correct") === false));

  await p.click('.tab[data-view="words"]');
  await p.click("#words-add");
  await p.fill("#edit-en", "visit");
  await p.fill("#edit-ja", "訪れる");
  await p.fill("#edit-example", "I visited Kyoto.");
  await p.fill("#edit-example-ja", "私は京都を訪れました。");
  await p.click('#edit-form button[type="submit"]');
  check("例文の訳を登録", await p.evaluate(() => db.words.find((w) => w.en === "visit").exampleJa === "私は京都を訪れました。"));
  const csv5 = path.join(tmp, "five.csv");
  fs.writeFileSync(csv5, "英語,日本語訳,種類,例文,例文の訳\r\nquiet,静かな,単語,Be quiet.,静かにしなさい。\r\n");
  await p.click("#edit-cancel");
  await p.click('.tab[data-view="settings"]');
  await p.setInputFiles("#csv-file", csv5);
  await p.waitForTimeout(200);
  check("CSVの5列目は例文の訳", await p.evaluate(() => db.words.find((w) => w.en === "quiet").exampleJa === "静かにしなさい。"));
  const [dl5] = await Promise.all([p.waitForEvent("download"), p.click("#csv-export")]);
  check("書き出しにも例文の訳", fs.readFileSync(await dl5.path(), "utf8").includes("quiet,静かな,単語,Be quiet.,静かにしなさい。"));

  // --- 学年 ---
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  check("サンプルにも学年", await p.evaluate(() => db.words.find((w) => w.en === "borrow").grade === 2));
  await p.evaluate(() => { for (const w of db.words) delete w.grade; saveDB(); });
  await p.reload();
  check("前からある単語にも学年が入る", await p.evaluate(() =>
    db.words.find((w) => w.en === "apple").grade === 1 && db.words.find((w) => w.en === "take care of").grade === 2));
  check("many と much は別の意味", await p.evaluate(() =>
    !sameMeaning("（数えられる）たくさんの", "（数えられない）たくさんの") && sameMeaning("（数えられる）たくさんの", "たくさんの")));

  await p.click('.tab[data-view="settings"]');
  const packBtn = (g) => p.locator(".pack-row").nth(g - 1).locator("button");
  check("単語セットは学年ごと", (await p.locator(".pack-row").count()) === 3);
  await packBtn(1).click();
  const n1 = await p.evaluate(() => WORD_BANK[1].length);
  check("1年の単語を追加", (await p.evaluate(() => db.words.length)) === 10 + n1 && (await p.textContent("#pack-result")).includes(`${n1}語 追加`));
  check("追加ずみ", (await packBtn(1).textContent()).includes("追加ずみ") && (await packBtn(1).isDisabled()));
  check("追加した単語に例文と訳", await p.evaluate(() => {
    const w = db.words.find((x) => x.en === "be from");
    return w.grade === 1 && w.type === "idiom" && w.exampleJa === "私は京都出身です。";
  }));
  // 自分で直した訳は、2年のセットを入れても上書きしない
  await p.evaluate(() => { db.words.push(makeWord("visit", "おとずれる（自分の訳）", "word")); saveDB(); renderPacks(); });
  await packBtn(2).click();
  check("自分の訳はそのまま、学年はうめる", await p.evaluate(() => {
    const w = db.words.find((x) => x.en === "visit");
    return w.ja === "おとずれる（自分の訳）" && w.grade === 2 && w.example === "I visited Nara last summer.";
  }));
  check("すでにあった単語を知らせる", (await p.textContent("#pack-result")).includes("すでにあった 1語"));

  await p.click('.tab[data-view="home"]');
  await p.click('#grade-filter [data-grade="2"]');
  check("学年の選択を覚える", await p.evaluate(() => db.settings.gradeFilter === 2));
  check("今日の残りに学年", (await p.textContent("#today-line")).startsWith("2年"));
  const q2 = await p.evaluate(() => { const { review, fresh } = todayQueue(); return [...review, ...fresh].map((w) => w.grade); });
  check("2年の単語だけ出す", q2.length === 10 && q2.every((g) => g === 2), q2.join(","));
  await p.click('[data-scope="all"]');
  await p.click('[data-mode="cards"]');
  check("全部も学年でしぼる", await p.evaluate(() => session.queue.every((id) => db.words.find((w) => w.id === id).grade === 2)));
  await p.click("#study-quit");
  dialogs.length = 0;
  await p.click('#grade-filter [data-grade="3"]');
  await p.click('[data-mode="cards"]');
  check("単語がない学年は追加をすすめる", dialogs.length === 1 && dialogs[0].includes("学年別の単語セット"));
  await p.click('#grade-filter [data-grade="0"]');
  await p.click('[data-scope="today"]');

  await p.click('.tab[data-view="words"]');
  await p.click('#words-grade [data-grade="1"]');
  check("単語帳を学年でしぼる", (await p.textContent("#words-count")) === `${7 + n1} 件`, await p.textContent("#words-count"));
  check("学年を表示", (await p.locator(".grade-chip").first().textContent()) === "1年");
  await p.click("#words-add");
  check("追加は選んでいる学年で始まる", await p.evaluate(() => editGrade === 1));
  await p.fill("#edit-en", "pencil");
  await p.fill("#edit-ja", "えんぴつ");
  await p.click('#edit-grade [data-grade="3"]');
  await p.click('#edit-form button[type="submit"]');
  check("学年を登録", await p.evaluate(() => db.words.find((w) => w.en === "pencil").grade === 3));
  await p.click("#edit-cancel");

  const csv6 = path.join(tmp, "six.csv");
  fs.writeFileSync(csv6, "英語,日本語訳,種類,例文,例文の訳,学年\r\neraser,消しゴム,単語,,,中2\r\n");
  await p.click('.tab[data-view="settings"]');
  await p.setInputFiles("#csv-file", csv6);
  await p.waitForTimeout(200);
  check("CSVの6列目は学年", await p.evaluate(() => db.words.find((w) => w.en === "eraser").grade === 2));
  const [dl6] = await Promise.all([p.waitForEvent("download"), p.click("#csv-export")]);
  check("書き出しにも学年", fs.readFileSync(await dl6.path(), "utf8").includes("eraser,消しゴム,単語,,,2年"));

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
