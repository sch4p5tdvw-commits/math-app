const $ = (id) => document.getElementById(id);

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function speakWord(text) {
  Speech.speak(text, { rate: db.settings.rate, voiceURI: db.settings.voiceURI });
}

// ---------------------------------------------------------------
// 画面の切りかえ
// ---------------------------------------------------------------
const VIEWS = ["home", "study", "done", "words", "edit", "settings"];
// 学習中はタブを隠して、まちがって画面を移らないようにする
const FOCUS_VIEWS = ["study", "edit"];

function show(view) {
  for (const v of VIEWS) $("view-" + v).hidden = v !== view;
  $("tabbar").hidden = FOCUS_VIEWS.includes(view);
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("is-on", t.dataset.view === view);
  }
  if (view !== "study") Speech.stop();
  if (view === "home") renderHome();
  if (view === "words") renderWords();
  if (view === "settings") renderSettings();
  window.scrollTo(0, 0);
}

for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => show(t.dataset.view));
}

function renderHome() {
  $("home-total").textContent = db.words.length;
}

// ---------------------------------------------------------------
// カードめくり
// ---------------------------------------------------------------
let session = null;

function startCards() {
  if (db.words.length === 0) {
    alert("単語帳に単語がありません。先に「単語帳」から追加してください。");
    return;
  }
  session = {
    queue: shuffle(db.words).map((w) => w.id),
    total: db.words.length,
    done: 0,
    known: 0,
    retried: new Set(),
  };
  show("study");
  showCard();
}

function currentWord() {
  return db.words.find((w) => w.id === session.queue[0]) || null;
}

function showCard() {
  const w = currentWord();
  if (!w) {
    finishSession();
    return;
  }
  $("study-progress").textContent = `${session.done + 1} / ${session.total}`;
  $("fc-type").textContent = TYPE_LABEL[w.type];
  $("fc-type").className = "badge badge-" + w.type;
  $("fc-en").textContent = w.en;
  $("fc-ja").textContent = w.ja;

  // 熟語は使い方がわかるよう、表のときから例文を見せる
  const front = $("fc-example-front");
  const back = $("fc-example-back");
  front.textContent = back.textContent = w.example;
  front.hidden = !(w.example && w.type === "idiom");
  back.hidden = !(w.example && w.type === "word");

  $("fc-back").hidden = true;
  $("fc-hint").hidden = false;
  $("answer-buttons").hidden = true;
  $("flashcard").classList.remove("is-flipped");
  if (db.settings.autoSpeak) speakWord(w.en);
}

function flipCard() {
  if (!$("fc-back").hidden) return;
  $("fc-back").hidden = false;
  $("fc-hint").hidden = true;
  $("answer-buttons").hidden = false;
  $("flashcard").classList.add("is-flipped");
}

function answerCard(known) {
  const id = session.queue.shift();
  if (known) {
    session.done++;
    if (!session.retried.has(id)) session.known++;
  } else {
    // 知らなかったカードは少しあとにもう一度出す
    session.retried.add(id);
    const pos = Math.min(session.queue.length, 3);
    session.queue.splice(pos, 0, id);
  }
  showCard();
}

function finishSession() {
  const s = session;
  session = null;
  $("done-summary").textContent = `${s.total}語のうち、はじめから知ってたのは ${s.known}語でした。`;
  show("done");
}

$("start-cards").addEventListener("click", startCards);
$("flashcard").addEventListener("click", (e) => {
  if (e.target.closest(".btn-speak")) return;
  flipCard();
});
$("flashcard").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flipCard();
  }
});
$("fc-speak").addEventListener("click", () => {
  const w = currentWord();
  if (w) speakWord(w.en);
});
$("ans-known").addEventListener("click", () => answerCard(true));
$("ans-unknown").addEventListener("click", () => answerCard(false));
$("study-quit").addEventListener("click", () => {
  session = null;
  show("home");
});
$("done-home").addEventListener("click", () => show("home"));

// ---------------------------------------------------------------
// 単語帳
// ---------------------------------------------------------------
let wordsFilter = "all";

function renderWords() {
  const q = $("words-search").value.trim().toLowerCase();
  const list = db.words
    .filter((w) => wordsFilter === "all" || w.type === wordsFilter)
    .filter((w) => !q || w.en.toLowerCase().includes(q) || w.ja.includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  $("words-count").textContent = `${list.length} 件`;
  const ul = $("word-list");
  ul.innerHTML = "";
  for (const w of list) {
    const li = document.createElement("li");
    li.className = "word-row";
    li.innerHTML = `
      <button type="button" class="word-main">
        <span class="badge badge-${w.type}"></span>
        <span class="word-en" lang="en"></span>
        <span class="word-ja"></span>
      </button>
      <button type="button" class="btn-speak btn-speak-small" aria-label="読み上げ">🔊</button>`;
    li.querySelector(".badge").textContent = TYPE_LABEL[w.type];
    li.querySelector(".word-en").textContent = w.en;
    li.querySelector(".word-ja").textContent = w.ja;
    li.querySelector(".word-main").addEventListener("click", () => openEdit(w.id));
    li.querySelector(".btn-speak").addEventListener("click", () => speakWord(w.en));
    ul.appendChild(li);
  }
  if (list.length === 0) {
    ul.innerHTML = `<li class="word-empty">見つかりませんでした</li>`;
  }
}

$("words-search").addEventListener("input", renderWords);
for (const b of $("words-filter").querySelectorAll(".seg-btn")) {
  b.addEventListener("click", () => {
    wordsFilter = b.dataset.filter;
    for (const x of $("words-filter").querySelectorAll(".seg-btn")) x.classList.toggle("is-on", x === b);
    renderWords();
  });
}
$("words-add").addEventListener("click", () => openEdit(null));

// ---------------------------------------------------------------
// 追加・編集
// ---------------------------------------------------------------
let editingId = null;
let editType = "word";

function setEditType(type) {
  editType = type;
  for (const b of $("edit-type").querySelectorAll(".seg-btn")) {
    b.classList.toggle("is-on", b.dataset.type === type);
  }
}

function openEdit(id) {
  editingId = id;
  const w = id ? db.words.find((x) => x.id === id) : null;
  $("edit-title").textContent = w ? "単語を編集" : "単語を追加";
  $("edit-en").value = w ? w.en : "";
  $("edit-ja").value = w ? w.ja : "";
  $("edit-example").value = w ? w.example : "";
  setEditType(w ? w.type : "word");
  $("edit-delete").hidden = !w;
  $("edit-warn").hidden = true;
  show("edit");
  if (!w) $("edit-en").focus();
}

for (const b of $("edit-type").querySelectorAll(".seg-btn")) {
  b.addEventListener("click", () => setEditType(b.dataset.type));
}

// スペースの入った見出しは熟語のことが多いので、追加のときは種類を合わせておく
$("edit-en").addEventListener("input", () => {
  if (!editingId) setEditType(/\s/.test($("edit-en").value.trim()) ? "idiom" : "word");
});

$("edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const en = $("edit-en").value.trim();
  const ja = $("edit-ja").value.trim();
  const example = $("edit-example").value.trim();
  if (!en || !ja) return;

  const dup = findWordByEn(en, editingId);
  if (dup) {
    $("edit-warn").textContent = `「${dup.en}」はもう登録されています（${dup.ja}）。`;
    $("edit-warn").classList.remove("is-ok");
    $("edit-warn").hidden = false;
    return;
  }

  if (editingId) {
    const w = db.words.find((x) => x.id === editingId);
    Object.assign(w, { en, ja, type: editType, example });
    saveDB();
    show("words");
  } else {
    db.words.push(makeWord(en, ja, editType, example));
    saveDB();
    // 続けて登録しやすいよう、追加のあとは空のフォームのまま残る
    openEdit(null);
    $("edit-warn").textContent = `「${en}」を追加しました。続けて入力できます。`;
    $("edit-warn").hidden = false;
    $("edit-warn").classList.add("is-ok");
    return;
  }
});

$("edit-cancel").addEventListener("click", () => show("words"));
$("edit-delete").addEventListener("click", () => {
  const w = db.words.find((x) => x.id === editingId);
  if (!w || !confirm(`「${w.en}」を削除しますか？`)) return;
  db.words = db.words.filter((x) => x.id !== editingId);
  saveDB();
  show("words");
});

// ---------------------------------------------------------------
// 設定・CSV
// ---------------------------------------------------------------
function renderSettings() {
  const s = db.settings;
  $("set-autospeak").checked = s.autoSpeak;
  $("set-rate").value = s.rate;
  $("set-rate-label").textContent = s.rate.toFixed(1);
  renderVoiceList();
}

function renderVoiceList() {
  const sel = $("set-voice");
  sel.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "おまかせ（アメリカ英語）";
  sel.appendChild(auto);
  for (const v of Speech.voices) {
    const o = document.createElement("option");
    o.value = v.voiceURI;
    o.textContent = `${v.name}（${v.lang}）`;
    sel.appendChild(o);
  }
  sel.value = db.settings.voiceURI;
  if (sel.value !== db.settings.voiceURI) sel.value = "";
  $("speech-unsupported").hidden = Speech.supported;
}

if (Speech.supported) {
  speechSynthesis.addEventListener("voiceschanged", () => {
    if (!$("view-settings").hidden) renderVoiceList();
  });
}

$("set-autospeak").addEventListener("change", (e) => {
  db.settings.autoSpeak = e.target.checked;
  saveDB();
});
$("set-rate").addEventListener("input", (e) => {
  db.settings.rate = Number(e.target.value);
  $("set-rate-label").textContent = db.settings.rate.toFixed(1);
  saveDB();
});
$("set-voice").addEventListener("change", (e) => {
  db.settings.voiceURI = e.target.value;
  saveDB();
  speakWord("Hello. Nice to meet you.");
});
$("set-voice-test").addEventListener("click", () => speakWord("Hello. Nice to meet you."));

$("csv-export").addEventListener("click", () => {
  downloadText(`eitango-${todayStr()}.csv`, exportCSVText(), "text/csv");
});
$("csv-import").addEventListener("click", () => $("csv-file").click());
$("csv-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 同じファイルをもう一度選んでも動くように
  if (!file) return;
  const text = decodeCSVBytes(await file.arrayBuffer());
  const r = importCSVText(text);
  let msg = `追加 ${r.added}件、上書き ${r.updated}件`;
  if (r.skipped.length) msg += `\n英語か日本語訳が空の行はとばしました（${r.skipped.slice(0, 10).join(", ")}行目${r.skipped.length > 10 ? " ほか" : ""}）`;
  $("csv-result").textContent = msg;
  $("csv-result").hidden = false;
});

// ---------------------------------------------------------------
show("home");
