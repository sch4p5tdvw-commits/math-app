// ===== レベル設定 =====
// レベル1: 1桁+1桁（こたえも1桁）
// レベル2: 1桁+1桁（こたえが2桁）
// レベル3: 1桁同士のひきざん（こたえは0いじょう）
// レベル4: 2桁から1桁をひく ひきざん
// レベル5: 1桁同士のかけざん
// レベル6: 2桁×1桁のかけざん
// レベル7: 2桁以下÷1桁のわりざん（わりきれるもの）
// レベル8: 3桁÷1桁のわりざん（わりきれるもの）
const LEVELS = [
  { id: 1, label: "レベル1", hint: "1けた＋1けた（こたえも1けた）" },
  { id: 2, label: "レベル2", hint: "1けた＋1けた（こたえは2けた）" },
  { id: 3, label: "レベル3", hint: "1けたどうしの ひきざん" },
  { id: 4, label: "レベル4", hint: "2けた－1けた の ひきざん" },
  { id: 5, label: "レベル5", hint: "1けたどうしの かけざん" },
  { id: 6, label: "レベル6", hint: "2けた×1けた の かけざん" },
  { id: 7, label: "レベル7", hint: "2けたいか÷1けた の わりざん" },
  { id: 8, label: "レベル8", hint: "3けた÷1けた の わりざん" },
];

const HISTORY_KEY = "mathapp_history";
const PLAYER_KEY = "mathapp_current_player";
const PLAYER_LIST_KEY = "mathapp_player_list";
const GROUP_KEY = "mathapp_group_code";
const DATA_VERSION_KEY = "mathapp_data_version";
const DATA_VERSION = "2";
const MAX_ANSWER_DIGITS = 3;
const WRONG_ANSWER_PENALTY_SEC = 3;

// ===== 状態 =====
let state = null;
let audioCtx = null;
let correctAudio = null;
let wrongAudio = null;
let cloud = null; // { db, api } — クラウドが使えないときは null のまま
let cloudScoreCache = [];
let cloudPlayerCache = [];

// ===== ユーティリティ =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 記録の意味が変わるアップデート時に、既存の記録を一度だけリセットする
function maybeResetHistory() {
  if (localStorage.getItem(DATA_VERSION_KEY) !== DATA_VERSION) {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION);
  }
}

// ===== あいことば（グループ） =====
function getGroupCode() {
  return localStorage.getItem(GROUP_KEY) || null;
}

function setGroupCode(code) {
  localStorage.setItem(GROUP_KEY, code);
}

function clearGroupCode() {
  localStorage.removeItem(GROUP_KEY);
}

// あいことばはそのまま Firestore のドキュメントIDに使うため、
// パスに使えない文字や大文字小文字のゆれをここで吸収する。
function normalizeGroupCode(raw) {
  return raw.trim().toLowerCase().replace(/[^0-9a-z぀-ヿ一-鿿]/g, "").slice(0, 20);
}

// ===== クラウドどうき（Realtime Database REST API）=====
// SDK を CDN から読み込まず REST を直接使う。読み込むファイルが増えないぶん
// 起動が速く、CDN が使えない環境でもアプリが動く。
// 通信に失敗した場合は端末内（localStorage）だけで動作させる。
function initCloud() {
  const config = window.FIREBASE_CONFIG;
  if (!config || !config.databaseURL) return false;
  cloud = { baseUrl: config.databaseURL.replace(/\/+$/, "") };
  return true;
}

function groupUrl(node) {
  return `${cloud.baseUrl}/groups/${encodeURIComponent(getGroupCode())}/${node}.json`;
}

function scoresUrl() {
  return groupUrl("scores");
}

// なまえは記録とは別に保存する。記録から名前を逆算していると、
// まだ1回も遊んでいない人の名前がほかの端末に伝わらないため。
async function pushPlayerToCloud(name) {
  if (!cloud || !getGroupCode()) return;
  try {
    await fetch(groupUrl("players"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    // 送信できなくても端末内には残るので、そのまま続行する
  }
}

async function fetchPlayersFromCloud() {
  if (!cloud || !getGroupCode()) return [];
  try {
    const res = await fetch(groupUrl("players"));
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== "object") return [];
    return Object.values(data)
      .map((p) => (p && typeof p === "object" ? p.name : null))
      .filter((n) => typeof n === "string" && n.length > 0);
  } catch {
    return [];
  }
}

async function pushScoreToCloud(entry) {
  if (!cloud || !getGroupCode()) return;
  try {
    // POST するとサーバー側でキーが自動採番され、端末どうしがぶつからない
    await fetch(scoresUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch {
    // 送信に失敗しても端末内には残っているので、そのまま続行する
  }
}

async function fetchScoresFromCloud() {
  if (!cloud || !getGroupCode()) return [];
  try {
    const res = await fetch(scoresUrl());
    if (!res.ok) return [];
    const data = await res.json();
    // Realtime Database は { 自動キー: 記録, ... } の形でかえってくる
    if (!data || typeof data !== "object") return [];
    return Object.values(data).filter((s) => s && typeof s === "object");
  } catch {
    // オフラインなど
    return [];
  }
}

// クラウドと端末内の記録を、id をキーに重複を除いて合わせる
function mergeScores(cloudScores, localScores) {
  const byId = new Map();
  [...localScores, ...cloudScores].forEach((s) => {
    if (s && s.id != null) byId.set(String(s.id), s);
  });
  return Array.from(byId.values());
}

async function refreshCloudScores() {
  const [scores, players] = await Promise.all([
    fetchScoresFromCloud(),
    fetchPlayersFromCloud(),
  ]);
  cloudScoreCache = scores;
  cloudPlayerCache = players;
}

// ===== 効果音 =====
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(ctx, freq, startTime, duration, type, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playSynthCorrectSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.15, "sine", 0.25); // ピン
  playTone(ctx, 659, now + 0.15, 0.3, "sine", 0.25); // ポーン
}

function playCorrectSound() {
  if (!correctAudio) {
    correctAudio = new Audio("sounds/correct.mp3");
    correctAudio.preload = "auto";
  }
  correctAudio.currentTime = 0;
  correctAudio.play().catch(() => playSynthCorrectSound());
}

function playSynthWrongSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 180, now, 0.18, "sawtooth", 0.2); // ブッ
  playTone(ctx, 160, now + 0.22, 0.3, "sawtooth", 0.2); // ブー
}

function playWrongSound() {
  if (!wrongAudio) {
    wrongAudio = new Audio("sounds/wrong.mp3");
    wrongAudio.preload = "auto";
  }
  wrongAudio.currentTime = 0;
  wrongAudio.play().catch(() => playSynthWrongSound());
}

// レベルごとに考えられる問題パターンを全て列挙する
function buildProblemBank(level) {
  const problems = [];
  if (level === 1) {
    // 1桁 + 1桁、こたえも1桁 (合計が9以下)
    for (let a = 1; a <= 8; a++) {
      for (let b = 1; b <= 9 - a; b++) {
        problems.push({ text: `${a} ＋ ${b} = ?`, answer: a + b });
      }
    }
  } else if (level === 2) {
    // 1桁 + 1桁、こたえは2桁 (合計が10以上)
    for (let a = 1; a <= 9; a++) {
      const minB = Math.max(1, 10 - a);
      for (let b = minB; b <= 9; b++) {
        problems.push({ text: `${a} ＋ ${b} = ?`, answer: a + b });
      }
    }
  } else if (level === 3) {
    // 1桁同士のひきざん、こたえは0以上
    for (let a = 0; a <= 9; a++) {
      for (let b = 0; b <= a; b++) {
        problems.push({ text: `${a} － ${b} = ?`, answer: a - b });
      }
    }
  } else if (level === 4) {
    // 2桁から1桁をひく
    for (let a = 10; a <= 99; a++) {
      for (let b = 1; b <= 9; b++) {
        problems.push({ text: `${a} － ${b} = ?`, answer: a - b });
      }
    }
  } else if (level === 5) {
    // 1桁同士のかけざん（×1 はこたえがそのままなので使わない）
    for (let a = 2; a <= 9; a++) {
      for (let b = 2; b <= 9; b++) {
        problems.push({ text: `${a} × ${b} = ?`, answer: a * b });
      }
    }
  } else if (level === 6) {
    // 2桁 × 1桁のかけざん（×1 はのぞく）
    for (let a = 10; a <= 99; a++) {
      for (let b = 2; b <= 9; b++) {
        problems.push({ text: `${a} × ${b} = ?`, answer: a * b });
      }
    }
  } else if (level === 7) {
    // 2桁以下 ÷ 1桁、わりきれるものだけ（÷1 はのぞく）
    for (let a = 1; a <= 99; a++) {
      for (let b = 2; b <= 9; b++) {
        if (a % b === 0) problems.push({ text: `${a} ÷ ${b} = ?`, answer: a / b });
      }
    }
  } else {
    // 3桁 ÷ 1桁、わりきれるものだけ（÷1 はのぞく）
    for (let a = 100; a <= 999; a++) {
      for (let b = 2; b <= 9; b++) {
        if (a % b === 0) problems.push({ text: `${a} ÷ ${b} = ?`, answer: a / b });
      }
    }
  }
  return problems;
}

const problemBanks = {};
const problemDecks = {};
const lastDrawnText = {};

// 全パターンをシャッフルした「山札」から1問ずつ引く。山札を引き切ったら
// 再シャッフルするが、その継ぎ目でも同じ問題が連続しないようにする。
function drawProblem(level) {
  if (!problemBanks[level]) problemBanks[level] = buildProblemBank(level);
  let deck = problemDecks[level];
  if (!deck || deck.length === 0) {
    deck = shuffle(problemBanks[level]);
    const last = lastDrawnText[level];
    if (last && deck.length > 1 && deck[0].text === last) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    problemDecks[level] = deck;
  }
  const problem = deck.shift();
  lastDrawnText[level] = problem.text;
  return problem;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
}

function saveHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  saveHistory(history);
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ===== プレイヤー =====
function getCurrentPlayer() {
  return localStorage.getItem(PLAYER_KEY) || null;
}

function setCurrentPlayer(name) {
  localStorage.setItem(PLAYER_KEY, name);
}

function clearCurrentPlayer() {
  localStorage.removeItem(PLAYER_KEY);
}

function renderPlayerBar() {
  document.getElementById("player-display").textContent = `👤 ${getCurrentPlayer()} さん`;
}

function loadPlayerList() {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_LIST_KEY)) || [];
  } catch {
    return [];
  }
}

function rememberPlayer(name) {
  const list = loadPlayerList().filter((n) => n !== name);
  list.unshift(name);
  localStorage.setItem(PLAYER_LIST_KEY, JSON.stringify(list.slice(0, 20)));
}

// 端末に登録済みの名前に、クラウド上の同じグループの名前も合わせて出す。
// これで新しい端末でも、あいことばを入れれば家族の名前がそのまま選べる。
function allKnownPlayerNames() {
  const names = loadPlayerList();
  const seen = new Set(names);
  // クラウドに登録された名前と、記録にふくまれる名前の両方から拾う
  const fromCloud = [...cloudPlayerCache, ...cloudScoreCache.map((s) => s && s.name)];
  fromCloud.forEach((name) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  });
  return names;
}

function renderPlayerList() {
  const container = document.getElementById("player-list");
  container.innerHTML = "";
  const names = allKnownPlayerNames();
  if (names.length === 0) return;

  const label = document.createElement("div");
  label.className = "player-list-label";
  label.textContent = "とうろくずみのなまえ";
  container.appendChild(label);

  names.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-list-item";
    btn.textContent = `👤 ${name}`;
    btn.dataset.name = name;
    container.appendChild(btn);
  });
}

function selectPlayer(name) {
  rememberPlayer(name);
  setCurrentPlayer(name);
  if (!cloudPlayerCache.includes(name)) {
    cloudPlayerCache = [...cloudPlayerCache, name];
    pushPlayerToCloud(name);
  }
  enterStartScreen();
}

// ===== 画面切り替え =====
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => (el.hidden = true));
  document.getElementById(id).hidden = false;
}

// ===== スタート画面 =====
function renderLevelGrid() {
  const grid = document.getElementById("level-grid");
  grid.innerHTML = "";
  LEVELS.forEach((lv) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "level-btn" + (lv.id === 1 ? " selected" : "");
    btn.dataset.level = lv.id;
    btn.innerHTML = `${lv.label}<small>${lv.hint}</small>`;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    grid.appendChild(btn);
  });
}

function getSelectedLevel() {
  const btn = document.querySelector(".level-btn.selected");
  return btn ? Number(btn.dataset.level) : 1;
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function renderRankingList(containerId, entries, compareFn, scoreLabelFn) {
  const list = document.getElementById(containerId);
  if (entries.length === 0) {
    list.innerHTML = '<div class="history-empty">まだきろくがないよ</div>';
    return;
  }
  const sorted = entries.slice().sort(compareFn);
  list.innerHTML = sorted
    .map((h, i) => {
      const rank = RANK_MEDALS[i] || `${i + 1}位`;
      return `<div class="history-item">
        <span class="rank-badge">${rank}</span>
        <span class="history-main">${formatDate(h.date)} / Lv${h.level}</span>
        <span>${scoreLabelFn(h)}</span>
      </div>`;
    })
    .join("");
}

function renderRanking(levelFilter) {
  const filter = levelFilter || document.getElementById("ranking-level-filter").value;
  const player = getCurrentPlayer();

  let entries = mergeScores(cloudScoreCache, loadHistory()).filter((h) => h.name === player);
  if (filter !== "all") {
    entries = entries.filter((h) => h.level === Number(filter));
  }

  renderRankingList(
    "ranking-normal-list",
    entries.filter((h) => h.mode === "normal"),
    (a, b) => a.elapsedSec - b.elapsedSec || b.accuracy - a.accuracy || new Date(b.date) - new Date(a.date),
    (h) => `${h.total}もん / ${h.elapsedSec}びょう (${h.accuracy}%)`
  );

  renderRankingList(
    "ranking-timeattack-list",
    entries.filter((h) => h.mode === "timeattack"),
    (a, b) => b.correct - a.correct || b.accuracy - a.accuracy || new Date(b.date) - new Date(a.date),
    (h) => `${h.correct}問正解 (${h.timeLimit}秒, ${h.accuracy}%)`
  );
}

// ===== クイズ開始 =====
function startQuiz() {
  const level = getSelectedLevel();
  const mode = document.querySelector('input[name="mode"]:checked').value;

  state = {
    level,
    mode,
    correct: 0,
    wrong: 0,
    index: 0,
    total: mode === "normal" ? Number(document.getElementById("question-count").value) : Infinity,
    timeLimit: mode === "timeattack" ? Number(document.getElementById("time-limit").value) : null,
    timeLeft: mode === "timeattack" ? Number(document.getElementById("time-limit").value) : null,
    startedAt: Date.now(),
    timerHandle: null,
    currentAnswer: null,
    inputBuffer: "",
    transitioning: false,
    finished: false,
  };

  showScreen("screen-quiz");
  document.getElementById("quiz-timer").textContent = mode === "timeattack" ? `⏱ ${state.timeLeft}s` : "";
  nextQuestion();

  if (mode === "timeattack") {
    state.timerHandle = setInterval(() => {
      state.timeLeft -= 1;
      document.getElementById("quiz-timer").textContent = `⏱ ${state.timeLeft}s`;
      if (state.timeLeft <= 0) {
        clearInterval(state.timerHandle);
        finishQuiz();
      }
    }, 1000);
  }
}

function updateQuizStatus() {
  document.getElementById("quiz-correct").textContent = state.correct;
  document.getElementById("quiz-wrong").textContent = state.wrong;
  if (state.mode === "normal") {
    document.getElementById("quiz-progress").textContent = `もんだい ${state.index + 1}/${state.total}`;
  } else {
    document.getElementById("quiz-progress").textContent = `もんだい ${state.index + 1}`;
  }
}

function renderAnswerDisplay() {
  const display = document.getElementById("answer-display");
  display.textContent = state.inputBuffer.length > 0 ? state.inputBuffer : " ";
}

function nextQuestion() {
  if (state.mode === "normal" && state.index >= state.total) {
    finishQuiz();
    return;
  }
  const problem = drawProblem(state.level);
  state.currentAnswer = problem.answer;
  state.inputBuffer = "";
  state.transitioning = false;
  document.getElementById("quiz-question").textContent = problem.text;
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "quiz-feedback";
  renderAnswerDisplay();
  updateQuizStatus();
}

function handleKeyPress(key) {
  // こたえあわせの表示中（つぎのもんだいへ移るまで）は入力を受け付けない
  if (!state || state.transitioning || state.finished) return;
  if (key === "back") {
    state.inputBuffer = state.inputBuffer.slice(0, -1);
    renderAnswerDisplay();
  } else if (key === "enter") {
    submitAnswer();
  } else {
    if (state.inputBuffer.length >= MAX_ANSWER_DIGITS) return;
    state.inputBuffer += key;
    renderAnswerDisplay();
  }
}

function submitAnswer() {
  if (!state || state.transitioning || state.finished) return;
  if (state.inputBuffer.length === 0) return;
  // 連打で同じこたえが二重に数えられないよう、つぎのもんだいまでロックする
  state.transitioning = true;
  const value = Number(state.inputBuffer);
  const feedback = document.getElementById("quiz-feedback");

  if (value === state.currentAnswer) {
    state.correct += 1;
    feedback.textContent = "せいかい！ 🎉";
    feedback.className = "quiz-feedback correct";
    playCorrectSound();
  } else {
    state.wrong += 1;
    feedback.textContent = `ざんねん… こたえは ${state.currentAnswer}`;
    feedback.className = "quiz-feedback wrong";
    playWrongSound();
  }

  state.index += 1;
  updateQuizStatus();

  setTimeout(() => {
    if (state.mode === "normal" && state.index >= state.total) {
      finishQuiz();
    } else {
      nextQuestion();
    }
  }, 600);
}

function finishQuiz() {
  // タイマーと、まだ残っている画面切りかえ待ちの両方から呼ばれうるので、
  // 記録が二重に保存されないよう一度だけ実行する
  if (!state || state.finished) return;
  state.finished = true;
  if (state.timerHandle) clearInterval(state.timerHandle);
  const totalAnswered = state.correct + state.wrong;
  const accuracy = totalAnswered > 0 ? Math.round((state.correct / totalAnswered) * 100) : 0;
  const rawElapsedSec = Math.round((Date.now() - state.startedAt) / 1000);
  const penaltySec = state.mode === "normal" ? state.wrong * WRONG_ANSWER_PENALTY_SEC : 0;
  const elapsedSec = rawElapsedSec + penaltySec;

  const entry = {
    id: Date.now(),
    date: new Date().toISOString(),
    level: state.level,
    mode: state.mode,
    name: getCurrentPlayer(),
    total: totalAnswered,
    correct: state.correct,
    wrong: state.wrong,
    accuracy,
    timeLimit: state.timeLimit,
    elapsedSec,
    rawElapsedSec,
  };
  saveHistoryEntry(entry);
  cloudScoreCache = mergeScores(cloudScoreCache, [entry]);
  pushScoreToCloud(entry);

  renderResult(entry);
  showScreen("screen-result");
}

function renderResult(entry) {
  document.getElementById("result-title").textContent =
    entry.mode === "timeattack" ? "タイムアタック けっか" : "けっか";

  const levelInfo = LEVELS.find((l) => l.id === entry.level);
  let timeLine;
  if (entry.mode === "timeattack") {
    timeLine = `<div>せいげんじかん: ${entry.timeLimit}びょう</div>`;
  } else if (entry.wrong > 0) {
    timeLine = `<div>クリアタイム: ${entry.elapsedSec}びょう (じっさい${entry.rawElapsedSec}びょう + まちがい${entry.wrong}問 × ${WRONG_ANSWER_PENALTY_SEC}びょう)</div>`;
  } else {
    timeLine = `<div>クリアタイム: ${entry.elapsedSec}びょう</div>`;
  }

  document.getElementById("result-stats").innerHTML = `
    <div class="big">${entry.correct} もん せいかい！</div>
    <div>せいかいりつ: ${entry.accuracy}%</div>
    <div>といたもんすう: ${entry.total}もん (まちがい ${entry.wrong}もん)</div>
    <div>レベル: ${entry.level} (${levelInfo ? levelInfo.hint : ""})</div>
    ${timeLine}
  `;
}

// ===== 初期化 =====
function renderGroupBar() {
  const bar = document.querySelector(".group-bar");
  const code = getGroupCode();
  // クラウドを使っていないときは、あいことばの欄自体を出さない
  bar.hidden = !cloud || !code;
  document.getElementById("group-display").textContent = code ? `あいことば: ${code}` : "";
}

function enterStartScreen() {
  renderPlayerBar();
  renderGroupBar();
  renderRanking("all");
  showScreen("screen-start");
}

function enterPlayerScreen() {
  renderPlayerList();
  showScreen("screen-player");
}

// あいことばが決まったら、クラウドから記録を読み直してから次の画面へ進む
async function syncAndRoute() {
  await refreshCloudScores();
  if (getCurrentPlayer()) {
    enterStartScreen();
  } else {
    enterPlayerScreen();
  }
}

async function init() {
  maybeResetHistory();
  renderLevelGrid();

  // クラウドが使えるかどうかに関わらず、まず今ある情報で画面を出す
  const cloudReady = initCloud();

  if (cloudReady && !getGroupCode()) {
    showScreen("screen-group");
  } else if (getCurrentPlayer()) {
    enterStartScreen();
  } else {
    enterPlayerScreen();
  }

  // クラウドが使えるなら、記録を取り込んでから画面を更新し直す
  if (cloudReady && getGroupCode()) {
    syncAndRoute();
  }

  document.getElementById("group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("group-code-input");
    const code = normalizeGroupCode(input.value);
    if (!code) return;
    setGroupCode(code);
    input.value = "";
    await syncAndRoute();
  });

  document.getElementById("btn-change-group").addEventListener("click", () => {
    clearGroupCode();
    clearCurrentPlayer();
    cloudScoreCache = [];
    cloudPlayerCache = [];
    showScreen("screen-group");
  });

  document.getElementById("player-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("player-name-input");
    const name = input.value.trim().slice(0, 10);
    if (!name) return;
    input.value = "";
    selectPlayer(name);
  });

  document.getElementById("player-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".player-list-item");
    if (!btn) return;
    selectPlayer(btn.dataset.name);
  });

  document.getElementById("btn-switch-player").addEventListener("click", () => {
    clearCurrentPlayer();
    enterPlayerScreen();
  });

  document.getElementById("ranking-level-filter").addEventListener("change", (e) => {
    renderRanking(e.target.value);
  });

  document.getElementById("btn-start").addEventListener("click", startQuiz);
  document.getElementById("keypad").addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    handleKeyPress(btn.dataset.key);
  });
  document.getElementById("btn-retry").addEventListener("click", startQuiz);
  document.getElementById("btn-back").addEventListener("click", enterStartScreen);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
