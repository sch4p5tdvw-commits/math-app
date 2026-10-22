const $ = (id) => document.getElementById(id);

function speakWord(text, slow) {
  const rate = slow ? Math.max(0.5, db.settings.rate - 0.3) : db.settings.rate;
  Speech.speak(text, { rate, voiceURI: db.settings.voiceURI });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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

let scope = "today";

const SCOPE_NOTE = {
  today: "まちがえた・知らなかった単語を先に、復習 → 新しい単語の順に出します。",
  weak: "まちがえたことがあって、まだ覚えきっていない単語だけを出します。",
  all: "登録した単語をぜんぶ、ばらばらの順で出します。",
};

function renderHome() {
  $("home-total").textContent = db.words.length;
  const { review, fresh } = todayQueue();
  $("today-line").innerHTML =
    review.length + fresh.length === 0
      ? "今日の分はおわりました 🎉"
      : `今日の分：復習 <b>${review.length}</b>語 ＋ 新しい単語 <b>${fresh.length}</b>語`;
  const weakN = db.words.filter(isWeak).length;
  $("scope-weak-n").textContent = weakN ? `（${weakN}）` : "";
  for (const b of $("scope").querySelectorAll(".seg-btn")) b.classList.toggle("is-on", b.dataset.scope === scope);
  $("scope-note").textContent = SCOPE_NOTE[scope];
}

for (const b of $("scope").querySelectorAll(".seg-btn")) {
  b.addEventListener("click", () => {
    scope = b.dataset.scope;
    renderHome();
  });
}

function buildQueue() {
  if (scope === "today") {
    const { review, fresh } = todayQueue();
    return [...review, ...fresh];
  }
  if (scope === "weak") return weakQueue();
  return shuffle(db.words);
}

const EMPTY_SCOPE_MSG = {
  today: "今日の分はもうおわっています。「苦手だけ」か「全部」で練習できます。",
  weak: "苦手な単語はありません。",
  all: "単語帳に単語がありません。先に「単語帳」から追加してください。",
};

// ---------------------------------------------------------------
// 学習の流れ（3つの出し方で共通）
// ---------------------------------------------------------------
const MODES = {
  cards: { show: showCard },
  ja2en: { show: showJa2En },
  en2ja: { show: showEn2Ja },
};

let session = null;

function startSession(mode) {
  const ids = buildQueue().map((w) => w.id);
  if (ids.length === 0) {
    alert(db.words.length === 0 ? EMPTY_SCOPE_MSG.all : EMPTY_SCOPE_MSG[scope]);
    return;
  }
  session = {
    mode,
    queue: ids,
    total: ids.length,
    done: 0,
    firstTry: 0,
    missed: new Set(), // 一度でもまちがえた・知らなかった単語
    pending: null, // 答え合わせのあと「次へ」を押すまでの結果
  };
  for (const m of Object.keys(MODES)) $("mode-" + m).hidden = m !== mode;
  show("study");
  nextItem();
}

function currentWord() {
  return session && db.words.find((w) => w.id === session.queue[0]) || null;
}

function nextItem() {
  const w = currentWord();
  if (!w) {
    finishSession();
    return;
  }
  $("study-progress").textContent = `${session.done + 1} / ${session.total}`;
  MODES[session.mode].show(w);
}

// 1問ぶんの結果を記録して次へ進む。まちがえた単語は少しあとにもう一度出す。
function recordAnswer(correct) {
  const id = session.queue.shift();
  const w = db.words.find((x) => x.id === id);
  if (w) applyResult(w, correct, !correct && !session.missed.has(id));
  if (correct) {
    session.done++;
    if (!session.missed.has(id)) session.firstTry++;
  } else {
    session.missed.add(id);
    session.queue.splice(Math.min(session.queue.length, 3), 0, id);
  }
  nextItem();
}

function finishSession() {
  const s = session;
  session = null;
  const word = s.mode === "cards" ? "知ってた" : "1回で正解した";
  $("done-summary").textContent = `${s.total}語のうち、${word}のは ${s.firstTry}語でした。`;
  const missed = db.words.filter((w) => s.missed.has(w.id));
  $("done-missed").hidden = missed.length === 0;
  $("done-missed-list").innerHTML = missed
    .map((w) => `<li><b lang="en">${escapeHtml(w.en)}</b>　${escapeHtml(w.ja)}</li>`)
    .join("");
  show("done");
}

function setTypeBadge(el, w) {
  el.textContent = TYPE_LABEL[w.type];
  el.className = "badge badge-" + w.type;
}

// 答え合わせのあとに出す、正解・訳・例文と「次へ」
function renderFeedback(el, ok, w, opts = {}) {
  el.innerHTML = `
    <p class="fb-mark ${ok ? "is-ok" : "is-ng"}">${ok ? "⭕ 正解！" : "❌ ざんねん"}</p>
    <div class="fb-word">
      <div>
        <p class="fb-en" lang="en">${escapeHtml(w.en)}</p>
        <p class="fb-ja">${escapeHtml(w.ja)}</p>
      </div>
      <button type="button" class="btn-speak btn-speak-small" data-act="speak" aria-label="読み上げ">🔊</button>
    </div>
    ${w.example ? `<p class="fc-example" lang="en">${escapeHtml(w.example)}</p>` : ""}
    ${opts.yours ? `<p class="fb-yours">あなたの答え：<span lang="en">${escapeHtml(opts.yours)}</span></p>` : ""}
    <button type="button" class="btn btn-primary btn-big" data-act="next">次へ</button>
    ${opts.canOverride ? `<button type="button" class="btn btn-ghost" data-act="override">今のは合ってた（正解にする）</button>` : ""}`;
  el.hidden = false;
  el.querySelector('[data-act="speak"]').addEventListener("click", () => speakWord(w.en));
  el.querySelector('[data-act="next"]').addEventListener("click", () => recordAnswer(session.pending));
  const ov = el.querySelector('[data-act="override"]');
  if (ov) {
    ov.addEventListener("click", () => {
      session.pending = true;
      renderFeedback(el, true, w);
    });
  }
  el.querySelector('[data-act="next"]').focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------------------------------------------------------------
// カードめくり
// ---------------------------------------------------------------
function showCard(w) {
  setTypeBadge($("fc-type"), w);
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
$("ans-known").addEventListener("click", () => recordAnswer(true));
$("ans-unknown").addEventListener("click", () => recordAnswer(false));

// ---------------------------------------------------------------
// 日 → 英（日本語を見て英語を書く）
// ---------------------------------------------------------------
function showJa2En(w) {
  setTypeBadge($("je-type"), w);
  $("je-ja").textContent = w.ja;
  $("je-hint").hidden = true;
  $("je-input").value = "";
  $("je-form").hidden = false;
  $("je-feedback").hidden = true;
  $("je-input").focus();
}

function answerJa2En(given) {
  const w = currentWord();
  const ok = given !== null && isCorrectAnswer(given, w.en);
  session.pending = ok;
  $("je-input").blur();
  $("je-form").hidden = true;
  $("je-hint").hidden = true;
  speakWord(w.en);
  // 書いたけれど合わなかったときだけ「正解にする」を出す（別の言い方で書いた場合など）
  renderFeedback($("je-feedback"), ok, w, { yours: ok ? "" : given, canOverride: !ok && !!given });
}

$("je-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("je-input").value.trim();
  if (v) answerJa2En(v);
});
$("je-giveup").addEventListener("click", () => answerJa2En(null));
$("je-hint-btn").addEventListener("click", () => {
  const w = currentWord();
  $("je-hint").textContent = hintFor(w.en);
  $("je-hint").hidden = false;
  $("je-input").focus();
});

// ---------------------------------------------------------------
// 英 → 日（聞いて英語を書く → 意味を4択）
// ---------------------------------------------------------------
function showEn2Ja(w) {
  session.spellOk = false;
  setTypeBadge($("ej-type"), w);
  $("ej-ask").textContent = "聞こえた英語を書こう";
  $("ej-listen").hidden = false;
  $("ej-en").hidden = true;
  $("ej-example").hidden = true;
  $("ej-input").value = "";
  $("ej-form").hidden = false;
  $("ej-spell").hidden = true;
  $("ej-choices").hidden = true;
  $("ej-feedback").hidden = true;
  speakWord(w.en);
  $("ej-input").focus();
}

function answerEn2JaSpelling(given) {
  const w = currentWord();
  const ok = given !== null && isCorrectAnswer(given, w.en);
  session.spellOk = ok;
  $("ej-input").blur();
  $("ej-form").hidden = true;

  // つづりの答え合わせ。ここで英語を見せてから、意味を選ぶ
  $("ej-en").textContent = w.en;
  $("ej-en").hidden = false;
  if (w.example) {
    $("ej-example").textContent = w.example;
    $("ej-example").hidden = false;
  }
  const spell = $("ej-spell");
  spell.className = "spell-result " + (ok ? "is-ok" : "is-ng");
  spell.innerHTML = ok
    ? "⭕ つづり正解！"
    : given
      ? `❌ つづりがちがいます（あなたの答え：<span lang="en">${escapeHtml(given)}</span>）`
      : "❌ 正しいつづりを確かめよう";
  spell.hidden = false;
  $("ej-ask").textContent = "意味はどれ？";

  const box = $("ej-choices");
  box.innerHTML = "";
  for (const c of makeChoices(w, db.words)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn choice";
    b.textContent = c.ja;
    b.dataset.correct = c.id === w.id ? "1" : "";
    b.addEventListener("click", () => answerEn2JaMeaning(b));
    box.appendChild(b);
  }
  box.hidden = false;
}

function answerEn2JaMeaning(btn) {
  const w = currentWord();
  const meaningOk = btn.dataset.correct === "1";
  for (const b of $("ej-choices").querySelectorAll(".choice")) {
    b.disabled = true;
    if (b.dataset.correct) b.classList.add("is-correct");
  }
  if (!meaningOk) btn.classList.add("is-wrong");
  // つづりと意味の両方が合って正解
  session.pending = session.spellOk && meaningOk;
  renderFeedback($("ej-feedback"), session.pending, w);
}

$("ej-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("ej-input").value.trim();
  if (v) answerEn2JaSpelling(v);
});
$("ej-giveup").addEventListener("click", () => answerEn2JaSpelling(null));
$("ej-play").addEventListener("click", () => speakWord(currentWord().en));
$("ej-slow").addEventListener("click", () => speakWord(currentWord().en, true));

// ---------------------------------------------------------------
for (const b of document.querySelectorAll(".btn-mode")) {
  b.addEventListener("click", () => startSession(b.dataset.mode));
}
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
    .filter((w) => wordsFilter === "all" || (wordsFilter === "weak" ? isWeak(w) : w.type === wordsFilter))
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
        <span class="word-status"></span>
      </button>
      <button type="button" class="btn-speak btn-speak-small" aria-label="読み上げ">🔊</button>`;
    li.querySelector(".badge").textContent = TYPE_LABEL[w.type];
    li.querySelector(".word-en").textContent = w.en;
    li.querySelector(".word-ja").textContent = w.ja;
    const st = wordStatus(w);
    li.querySelector(".word-status").textContent = st.text;
    li.querySelector(".word-status").className = "word-status " + st.cls;
    li.querySelector(".word-main").addEventListener("click", () => openEdit(w.id));
    li.querySelector(".btn-speak").addEventListener("click", () => speakWord(w.en));
    ul.appendChild(li);
  }
  if (list.length === 0) {
    ul.innerHTML = `<li class="word-empty">見つかりませんでした</li>`;
  }
}

function wordStatus(w) {
  if (isNew(w)) return { text: "未学習", cls: "st-new" };
  if (isMastered(w)) return { text: "✓ 覚えた", cls: "st-done" };
  const dots = "●".repeat(w.level || 0) + "○".repeat(MASTERED_LEVEL - (w.level || 0));
  return { text: `${dots}${isWeak(w) ? " 苦手" : ""}`, cls: isWeak(w) ? "st-weak" : "st-learning" };
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
