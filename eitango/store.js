// 単語と記録はすべて、この端末の localStorage に保存する。外へは送らない。
const STORE_KEY = "eitango-v1";

// 動作確認用の自作サンプル。市販の単語帳からは取っていない。
const SAMPLE_WORDS = [
  ["apple", "りんご", "word", "I eat an apple every morning."],
  ["library", "図書館", "word", "She studies at the library after school."],
  ["borrow", "借りる", "word", "Can I borrow your pen?"],
  ["important", "大切な、重要な", "word", "It is important to sleep well."],
  ["weather", "天気", "word", "The weather is nice today."],
  ["look for", "～を探す", "idiom", "I am looking for my key."],
  ["take care of", "～の世話をする", "idiom", "He takes care of his little sister."],
  ["be good at", "～が得意だ", "idiom", "My brother is good at soccer."],
  ["a lot of", "たくさんの", "idiom", "There are a lot of books in my room."],
  ["get up", "起きる", "idiom", "I get up at six every day."],
];

let db = loadDB();

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makeWord(en, ja, type, example) {
  return {
    id: newId(),
    en: en.trim(),
    ja: ja.trim(),
    type: type === "idiom" ? "idiom" : "word",
    example: (example || "").trim(),
    createdAt: Date.now(),
  };
}

function freshDB() {
  return {
    version: 1,
    words: SAMPLE_WORDS.map(([en, ja, type, ex]) => makeWord(en, ja, type, ex)),
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
  return data;
}

function saveDB() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    alert("保存できませんでした。端末の空き容量やブラウザの設定を確かめてください。");
  }
}

// 英語の見出しをくらべるときの形。大文字小文字や空白の差は同じものとみなす。
function normEn(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function findWordByEn(en, exceptId) {
  const key = normEn(en);
  return db.words.find((w) => w.id !== exceptId && normEn(w.en) === key) || null;
}
