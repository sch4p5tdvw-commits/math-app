const $ = (id) => document.getElementById(id);

function speakWord(text, slow) {
  const rate = slow ? Math.max(0.5, db.settings.rate - 0.3) : db.settings.rate;
  Speech.speak(text, { rate, voiceURI: db.settings.voiceURI });
}

// 効果音のあとに英語を読み上げる（音が重ならないように少し待つ）
let speakTimer = null;
function speakAfterSfx(text, played) {
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => speakWord(text), played ? Sfx.LENGTH * 1000 : 0);
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
  if (view !== "study") {
    clearTimeout(speakTimer);
    Speech.stop();
  }
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
  const today = todayStr();
  const log = db.log[today] || { count: 0 };
  const mastered = db.words.filter(isMastered).length;
  const streak = streakDays();
  $("stat-today").textContent = log.count;
  $("stat-streak").textContent = streak;
  $("stat-mastered").textContent = mastered;
  $("home-total").textContent = db.words.length;
  $("home-mastered-pct").textContent = db.words.length ? Math.round((mastered / db.words.length) * 100) : 0;

  // 今日の目標は「今日学習した数 ＋ 今日まだ残っている数」。全部やりきると 100%
  const { review, fresh } = todayQueue();
  const left = review.length + fresh.length;
  const pct = log.count + left === 0 ? 0 : Math.round((log.count / (log.count + left)) * 100);
  $("goal-fill").style.width = (left === 0 && log.count > 0 ? 100 : pct) + "%";
  $("goal-fill").classList.toggle("is-done", left === 0 && log.count > 0);
  $("today-line").innerHTML =
    left === 0
      ? log.count > 0
        ? "今日の目標クリア！ 🎉"
        : "今日の分はありません。単語を追加しよう"
      : `今日の残り：復習 <b>${review.length}</b>語 ＋ 新しい単語 <b>${fresh.length}</b>語`;
  const note = $("streak-note");
  note.hidden = !(streak > 0 && log.count === 0);
  note.textContent = `今日も学習すると ${streak + 1}日連続！`;
  renderWeek();
  const weakN = db.words.filter(isWeak).length;
  $("scope-weak-n").textContent = weakN ? `（${weakN}）` : "";
  for (const b of $("scope").querySelectorAll(".seg-btn")) b.classList.toggle("is-on", b.dataset.scope === scope);
  $("scope-note").textContent = SCOPE_NOTE[scope];
}

// この1週間の学習数を棒で見せる
function renderWeek() {
  const today = todayStr();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    days.push({ day, count: (db.log[day] && db.log[day].count) || 0 });
  }
  const max = Math.max(10, ...days.map((d) => d.count));
  const wk = "日月火水木金土";
  $("week").innerHTML = days
    .map((d) => {
      const [y, m, dd] = d.day.split("-").map(Number);
      const label = d.day === today ? "今日" : wk[new Date(y, m - 1, dd).getDay()];
      const h = Math.round((d.count / max) * 100);
      return `<div class="week-day${d.day === today ? " is-today" : ""}">
        <span class="week-n">${d.count || ""}</span>
        <div class="week-bar"><div class="week-fill" style="height:${h}%"></div></div>
        <span class="week-label">${label}</span></div>`;
    })
    .join("");
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
    words: ids.length, // はじめに出す単語の数
    total: ids.length, // もう一度出す分を足した問題数
    pos: 0, // 答えた問題数
    firstTry: 0,
    missed: new Set(), // 一度でもまちがえた・知らなかった単語
    retried: new Set(), // もう一度出す分を足した単語
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
  clearTimeout(speakTimer);
  $("study-progress").textContent = `${session.pos + 1} / ${session.total}`;
  $("study-retry").hidden = !session.missed.has(w.id);
  MODES[session.mode].show(w);
}

// 1問ぶんの結果を記録して次へ進む。まちがえた単語は少しあとにもう一度出す。
function recordAnswer(correct) {
  const id = session.queue.shift();
  const w = db.words.find((x) => x.id === id);
  if (w) applyResult(w, correct, !correct && !session.missed.has(id));
  session.pos++;
  if (correct) {
    if (!session.missed.has(id)) session.firstTry++;
  } else {
    session.missed.add(id);
    // もう一度出すのは1回だけ。最後の1枚で何度も同じカードが出て、先へ進めなくならないように。
    // それでも覚えられなかった単語は今日の復習に残るので、「今日の分」でまた出る。
    if (!session.retried.has(id)) {
      session.retried.add(id);
      session.queue.splice(Math.min(session.queue.length, 3), 0, id);
      session.total++;
    }
  }
  nextItem();
}

function finishSession() {
  const s = session;
  session = null;
  const word = s.mode === "cards" ? "知ってた" : "1回で正解した";
  $("done-summary").textContent = `${s.words}語のうち、${word}のは ${s.firstTry}語でした。`;
  const missed = db.words.filter((w) => s.missed.has(w.id));
  $("done-missed").hidden = missed.length === 0;
  $("done-missed-list").innerHTML = missed
    .map((w) => `<li><b lang="en">${escapeHtml(displayEn(w.en))}</b>　${escapeHtml(w.ja)}</li>`)
    .join("");
  show("done");
}

function setTypeBadge(el, w) {
  el.textContent = TYPE_LABEL[w.type];
  el.className = "badge badge-" + w.type;
}

// 例文。タップすると読み上げて、訳があれば見せる
function exampleHtml(w) {
  if (!w.example) return "";
  const tap = w.exampleJa ? "🔊 タップで音声と訳" : "🔊 タップで音声";
  return `
    <button type="button" class="example">
      <span class="ex-en" lang="en">${escapeHtml(w.example)}</span>
      <span class="ex-tap">${tap}</span>
      ${w.exampleJa ? `<span class="ex-ja" hidden>${escapeHtml(w.exampleJa)}</span>` : ""}
    </button>`;
}

document.addEventListener("click", (e) => {
  const ex = e.target.closest(".example");
  if (!ex) return;
  speakWord(ex.querySelector(".ex-en").textContent);
  const ja = ex.querySelector(".ex-ja");
  if (ja) {
    ja.hidden = false;
    ex.querySelector(".ex-tap").textContent = "🔊 もう一度聞く";
  }
});

function playResult(ok) {
  return Sfx.play(ok ? "correct" : "wrong");
}

// 答え合わせのあとに出す、正解・訳・例文と「次へ」
function renderFeedback(el, ok, w, opts = {}) {
  el.innerHTML = `
    <p class="fb-mark ${ok ? "is-ok" : "is-ng"}">${ok ? "⭕ 正解！" : "❌ ざんねん"}</p>
    <div class="fb-word">
      <div>
        <p class="fb-en" lang="en">${escapeHtml(displayEn(w.en))}</p>
        <p class="fb-ja">${escapeHtml(w.ja)}</p>
      </div>
      <button type="button" class="btn-speak btn-speak-small" data-act="speak" aria-label="読み上げ">🔊</button>
    </div>
    ${exampleHtml(w)}
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
      playResult(true);
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
  $("fc-en").textContent = displayEn(w.en);
  $("fc-ja").textContent = w.ja;

  // 例文から意味がわかってしまうので、例文は訳といっしょに裏に出す
  $("fc-example-back").innerHTML = exampleHtml(w);

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
  if (e.target.closest(".btn-speak, .example")) return;
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
  $("je-warn").hidden = true;
  $("je-alt").hidden = true;
  attachKeyboard("je-form");
  $("je-form").hidden = false;
  $("je-feedback").hidden = true;
  focusAnswer("je-input");
}

function answerJa2En(given) {
  const w = currentWord();
  const ok = given !== null && isCorrectAnswer(given, w.en);

  // 同じ意味の別の単語（a lot of に対する many など）を書いたときは、まちがいにせず書き直してもらう
  const syn = !ok && given !== null ? synonymAnswer(given, w, db.words) : null;
  if (syn) {
    $("je-alt").textContent = `「${displayEn(syn.en)}」も同じ意味で合っています。でも今回は別の言い方を答えてね`;
    $("je-alt").hidden = false;
    $("je-input").value = "";
    focusAnswer("je-input");
    return;
  }

  session.pending = ok;
  $("je-input").blur();
  $("je-form").hidden = true;
  $("je-hint").hidden = true;
  $("je-alt").hidden = true;
  speakAfterSfx(w.en, playResult(ok));
  // 書いたけれど合わなかったときだけ「正解にする」を出す（別の言い方で書いた場合など）
  renderFeedback($("je-feedback"), ok, w, { yours: ok ? "" : given, canOverride: !ok && !!given });
}

// かなや漢字が入っていたら、キーボードが日本語のままなので採点せずに知らせる
// （「be動詞」の漢字は答えの一部として書いてよい）
function hasJapanese(s) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(s.replace(/be\s*動詞/gi, ""));
}

function readAnswer(inputId, warnId) {
  const v = $(inputId).value.trim();
  if (!v) return null;
  if (hasJapanese(v)) {
    $(warnId).hidden = false;
    focusAnswer(inputId);
    return null;
  }
  return v;
}

for (const [inputId, warnId] of [["je-input", "je-warn"], ["ej-input", "ej-warn"]]) {
  $(inputId).addEventListener("input", () => ($(warnId).hidden = true));
}

$("je-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = readAnswer("je-input", "je-warn");
  if (v) answerJa2En(v);
});
$("je-giveup").addEventListener("click", () => answerJa2En(null));
$("je-hint-btn").addEventListener("click", () => {
  const w = currentWord();
  $("je-hint").textContent = hintFor(w.en);
  $("je-hint").hidden = false;
  focusAnswer("je-input");
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
  $("ej-input").value = "";
  $("ej-warn").hidden = true;
  attachKeyboard("ej-form");
  $("ej-form").hidden = false;
  $("ej-spell").hidden = true;
  $("ej-choices").hidden = true;
  $("ej-feedback").hidden = true;
  speakWord(w.en);
  focusAnswer("ej-input");
}

function answerEn2JaSpelling(given) {
  const w = currentWord();
  const ok = given !== null && isCorrectAnswer(given, w.en);
  session.spellOk = ok;
  $("ej-input").blur();
  $("ej-form").hidden = true;

  // つづりの答え合わせ。ここで英語を見せてから、意味を選ぶ
  $("ej-en").textContent = displayEn(w.en);
  $("ej-en").hidden = false;
  speakAfterSfx(w.en, playResult(ok));
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
  playResult(session.pending);
  renderFeedback($("ej-feedback"), session.pending, w);
}

$("ej-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = readAnswer("ej-input", "ej-warn");
  if (v) answerEn2JaSpelling(v);
});
$("ej-giveup").addEventListener("click", () => answerEn2JaSpelling(null));
$("ej-play").addEventListener("click", () => speakWord(currentWord().en));
$("ej-slow").addEventListener("click", () => speakWord(currentWord().en, true));

// ---------------------------------------------------------------
// アプリの中のキーボード
// 端末のキーボードは画面の半分をふさぎ、予測変換も出るので、答えはこれで書く。
// 使っているあいだは答えの欄を読み取り専用にして、端末のキーボードを出さない。
// ---------------------------------------------------------------
const KB_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m", "back"],
  ["'", "-", "space"],
];
const ANSWER_INPUTS = ["je-input", "ej-input"];

const keyboard = buildKeyboard();

function buildKeyboard() {
  const kb = document.createElement("div");
  kb.className = "kb";
  for (const row of KB_ROWS) {
    const r = document.createElement("div");
    r.className = "kb-row";
    for (const key of row) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kb-key";
      b.dataset.key = key;
      if (key === "back") {
        b.textContent = "⌫";
        b.classList.add("kb-back");
        b.setAttribute("aria-label", "1文字けす");
      } else if (key === "space") {
        b.textContent = "space";
        b.classList.add("kb-space");
      } else {
        b.textContent = key;
      }
      r.appendChild(b);
    }
    kb.appendChild(r);
  }
  // ⌫ は押しつづけると続けて消える
  let repeat = null;
  const stop = () => {
    clearTimeout(repeat);
    clearInterval(repeat);
    repeat = null;
  };
  kb.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".kb-key");
    if (!b) return;
    e.preventDefault();
    b.classList.add("is-down");
    pressKey(b.dataset.key);
    if (b.dataset.key === "back") {
      repeat = setTimeout(() => (repeat = setInterval(() => pressKey("back"), 80)), 450);
    }
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    kb.addEventListener(ev, () => {
      stop();
      for (const b of kb.querySelectorAll(".is-down")) b.classList.remove("is-down");
    });
  }
  return kb;
}

function activeAnswerInput() {
  if (!session) return null;
  if (session.mode === "ja2en" && !$("je-form").hidden) return $("je-input");
  if (session.mode === "en2ja" && !$("ej-form").hidden) return $("ej-input");
  return null;
}

function pressKey(key) {
  const input = activeAnswerInput();
  if (!input) return;
  if (key === "back") input.value = input.value.slice(0, -1);
  else if (key === "space") input.value += input.value && !input.value.endsWith(" ") ? " " : "";
  else input.value += key;
  input.dispatchEvent(new Event("input"));
}

// 出題中のフォームの中にキーボードを入れる
function attachKeyboard(formId) {
  applyKeyboardMode();
  $(formId).querySelector(".kb-slot").appendChild(keyboard);
}

function applyKeyboardMode() {
  const app = db.settings.appKeyboard;
  keyboard.hidden = !app;
  for (const id of ANSWER_INPUTS) {
    const input = $(id);
    input.readOnly = app;
    // アプリのキーボードのときは端末のキーボードを出さない。
    // 端末のキーボードのときは英字のキーボード（メール用）を出して、日本語の変換や予測変換を出さない
    input.inputMode = app ? "none" : "email";
    input.classList.toggle("is-appkb", app);
  }
}

// 端末のキーボードを使うときだけ、答えの欄にカーソルを置いてキーボードを出す
function focusAnswer(id) {
  if (!db.settings.appKeyboard) $(id).focus();
}

// パソコンのキーボードでも打てるようにする（答えの欄は読み取り専用なので、ここで受ける）
document.addEventListener("keydown", (e) => {
  if (!db.settings.appKeyboard || e.ctrlKey || e.metaKey || e.altKey) return;
  const input = activeAnswerInput();
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault();
    input.form.requestSubmit();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    pressKey("back");
  } else if (e.key === " ") {
    e.preventDefault();
    pressKey("space");
  } else if (/^[a-zA-Z'\-]$/.test(e.key)) {
    e.preventDefault();
    pressKey(e.key.toLowerCase());
  }
});

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
    .filter((w) => !q || normEn(w.en).includes(normEn(q)) || w.ja.includes(q))
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
    li.querySelector(".word-en").textContent = displayEn(w.en);
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
  $("edit-en").value = w ? displayEn(w.en) : "";
  $("edit-ja").value = w ? w.ja : "";
  $("edit-example").value = w ? w.example : "";
  $("edit-example-ja").value = w ? w.exampleJa || "" : "";
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
  const en = storeEn($("edit-en").value);
  const ja = $("edit-ja").value.trim();
  const example = $("edit-example").value.trim();
  const exampleJa = $("edit-example-ja").value.trim();
  if (!en || !ja) return;

  const dup = findWordByEn(en, editingId);
  if (dup) {
    $("edit-warn").textContent = `「${displayEn(dup.en)}」はもう登録されています（${dup.ja}）。`;
    $("edit-warn").classList.remove("is-ok");
    $("edit-warn").hidden = false;
    return;
  }

  if (editingId) {
    const w = db.words.find((x) => x.id === editingId);
    Object.assign(w, { en, ja, type: editType, example, exampleJa });
    saveDB();
    show("words");
  } else {
    db.words.push(makeWord(en, ja, editType, example, exampleJa));
    saveDB();
    // 続けて登録しやすいよう、追加のあとは空のフォームのまま残る
    openEdit(null);
    $("edit-warn").textContent = `「${displayEn(en)}」を追加しました。続けて入力できます。`;
    $("edit-warn").hidden = false;
    $("edit-warn").classList.add("is-ok");
    return;
  }
});

$("edit-cancel").addEventListener("click", () => show("words"));
$("edit-delete").addEventListener("click", () => {
  const w = db.words.find((x) => x.id === editingId);
  if (!w || !confirm(`「${displayEn(w.en)}」を削除しますか？`)) return;
  db.words = db.words.filter((x) => x.id !== editingId);
  saveDB();
  show("words");
});

// ---------------------------------------------------------------
// 設定・CSV
// ---------------------------------------------------------------
function renderSettings() {
  const s = db.settings;
  $("goal-new").textContent = s.newPerDay;
  $("set-appkb").checked = s.appKeyboard;
  $("set-sfx").checked = s.sfx;
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

function changeGoal(diff) {
  db.settings.newPerDay = Math.min(50, Math.max(0, db.settings.newPerDay + diff));
  $("goal-new").textContent = db.settings.newPerDay;
  saveDB();
}
$("goal-minus").addEventListener("click", () => changeGoal(-1));
$("goal-plus").addEventListener("click", () => changeGoal(1));

$("backup-save").addEventListener("click", () => {
  downloadText(`eitango-backup-${todayStr()}.json`, JSON.stringify(db), "application/json");
});
$("backup-load").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    data = null;
  }
  if (!data || !Array.isArray(data.words)) {
    alert("このファイルは英単語ノートのバックアップではないようです。");
    return;
  }
  if (!confirm(`バックアップ（${data.words.length}語）で、今の単語帳と記録を置きかえますか？`)) return;
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
  db = loadDB();
  saveDB();
  alert("復元しました。");
  renderSettings();
});
$("reset-progress").addEventListener("click", () => {
  if (!confirm("覚えた記録・連続日数などをすべて消して、全部の単語を未学習にもどします。よろしいですか？")) return;
  for (const w of db.words) Object.assign(w, { level: 0, due: null, reps: 0, lapses: 0, lastDay: null });
  db.log = {};
  saveDB();
  alert("学習の記録を消しました。");
});

$("set-sfx").addEventListener("change", (e) => {
  db.settings.sfx = e.target.checked;
  saveDB();
  if (db.settings.sfx) Sfx.play("correct");
});

$("set-appkb").addEventListener("change", (e) => {
  db.settings.appKeyboard = e.target.checked;
  saveDB();
  applyKeyboardMode();
});

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

// ホーム画面に置いたまま次の日に開いたときも、今日の数字に直す
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("view-home").hidden) renderHome();
});

// オフラインでも開けるようにする（https か localhost のときだけ動く）
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
