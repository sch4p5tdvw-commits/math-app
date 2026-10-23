// 単語と記録はすべて、この端末の localStorage に保存する。外へは送らない。
const STORE_KEY = "eitango-v1";
const TYPE_LABEL = { word: "単語", idiom: "熟語" };
const GRADES = [1, 2, 3];

const DEFAULT_SETTINGS = {
  autoSpeak: true, // カードを出したときに読み上げる
  rate: 0.9, // 読み上げの速さ
  voiceURI: "", // 空なら端末のアメリカ英語の声を選ぶ
  newPerDay: 10, // 1日に新しく覚える数
  appKeyboard: true, // 答えはアプリの中のキーボードで書く（端末のキーボードを出さない）
  sfx: true, // 正解・不正解の効果音
  gradeFilter: 0, // 出題する学年。0 はすべて
};

// 動作確認用の自作サンプル。市販の単語帳からは取っていない。
// [英語, 日本語訳, 種類, 例文, 例文の訳, 学年]
const SAMPLE_WORDS = [
  ["apple", "りんご", "word", "I eat an apple every morning.", "私は毎朝りんごを食べます。", 1],
  ["library", "図書館", "word", "She studies at the library after school.", "彼女は放課後、図書館で勉強します。", 1],
  ["borrow", "借りる", "word", "Can I borrow your pen?", "あなたのペンを借りてもいいですか。", 2],
  ["important", "大切な、重要な", "word", "It is important to sleep well.", "よく眠ることは大切です。", 2],
  ["weather", "天気", "word", "The weather is nice today.", "今日は天気がいいです。", 1],
  ["look for", "～を探す", "idiom", "I am looking for my key.", "私は鍵を探しています。", 1],
  ["take care of", "～の世話をする", "idiom", "He takes care of his little sister.", "彼は妹の世話をしています。", 2],
  ["be good at", "～が得意だ", "idiom", "My brother is good at soccer.", "私の兄はサッカーが得意です。", 1],
  ["a lot of", "たくさんの", "idiom", "There are a lot of books in my room.", "私の部屋にはたくさんの本があります。", 1],
  ["get up", "起きる", "idiom", "I get up at six every day.", "私は毎日6時に起きます。", 1],
];

let db = loadDB();

// 端末の時計での日付（YYYY-MM-DD）。日付の切りかわりは深夜0時
function todayStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makeWord(en, ja, type, example, exampleJa, grade) {
  return {
    id: newId(),
    en: storeEn(en),
    ja: ja.trim(),
    type: type === "idiom" ? "idiom" : "word",
    example: (example || "").trim(),
    exampleJa: (exampleJa || "").trim(), // 例文の訳
    grade: GRADES.includes(grade) ? grade : 0, // 学年（1〜3）。0 は学年なし
    createdAt: Date.now(),
    // 学習の進み具合（srs.js）。due が null のあいだは未学習
    level: 0,
    due: null,
    reps: 0,
    lapses: 0,
    lastDay: null,
  };
}

function freshDB() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    log: {}, // 日付ごとの学習数 { "2026-10-22": { count, newCount, correct, wrong } }
    words: SAMPLE_WORDS.map((s) => makeWord(...s)),
  };
}

function loadDB() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch (e) {
    data = null;
  }
  if (!data || !Array.isArray(data.words)) data = freshDB();
  // あとから増えた設定項目は初期値でうめる
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  if (!data.log || typeof data.log !== "object") data.log = {};
  // 例文の訳と学年はあとから増えた項目。前から入っているサンプルにはうめる
  for (const w of data.words) {
    const sample = SAMPLE_WORDS.find((s) => s[0] === w.en);
    if (w.exampleJa === undefined) w.exampleJa = sample && sample[3] === w.example ? sample[4] : "";
    if (w.grade === undefined) w.grade = sample ? sample[5] : 0;
  }
  return data;
}

function saveDB() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    alert("保存できませんでした。端末の空き容量やブラウザの設定を確かめてください。");
  }
}

// 「1年」「中1」「1」などを 1 に。読めなければ 0（学年なし）
function parseGrade(s) {
  const m = String(s ?? "").normalize("NFKC").match(/[123]/);
  return m ? Number(m[0]) : 0;
}

function gradeLabel(g) {
  return g ? `${g}年` : "";
}

// 熟語の頭の be は be動詞（am / is / are …）のこと。
// 保存と読み上げは "be good at" のまま、画面では "be動詞 good at" と書く。
// "(be) afraid of" や "a / b" の2つめの頭の be も同じ。
const BE_VERB_RE = /(^|\/\s*)(\(?)be(\)?)(?=\s)/gi;

function displayEn(en) {
  return en.replace(BE_VERB_RE, "$1$2be動詞$3");
}

// 入力や CSV に「be動詞」と書かれていたら be にもどして保存する
function storeEn(s) {
  return s.replace(/be\s*動詞/gi, "be").trim();
}

// 英語の見出しをくらべるときの形。大文字小文字や空白の差は同じものとみなす。
function normEn(s) {
  return storeEn(s).toLowerCase().replace(/\s+/g, " ");
}

function findWordByEn(en, exceptId) {
  const key = normEn(en);
  return db.words.find((w) => w.id !== exceptId && normEn(w.en) === key) || null;
}
