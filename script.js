// ===== レベル設定 =====
// レベル1: 1桁+1桁（こたえも1桁）
// レベル2: 1桁+1桁（こたえが2桁）
// レベル3: 1桁同士のひきざん（こたえは0いじょう）
// レベル4: 2桁から1桁をひく ひきざん
const LEVELS = [
  { id: 1, label: "レベル1", hint: "1けた＋1けた（こたえも1けた）" },
  { id: 2, label: "レベル2", hint: "1けた＋1けた（こたえは2けた）" },
  { id: 3, label: "レベル3", hint: "1けたどうしの ひきざん" },
  { id: 4, label: "レベル4", hint: "2けた－1けた の ひきざん" },
];

const HISTORY_KEY = "mathapp_history";
const PLAYER_KEY = "mathapp_current_player";
const DATA_VERSION_KEY = "mathapp_data_version";
const DATA_VERSION = "2";
const MAX_ANSWER_DIGITS = 3;

// ===== 状態 =====
let state = null;
let audioCtx = null;
let correctAudio = null;
let wrongAudio = null;

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
  } else {
    // 2桁から1桁をひく
    for (let a = 10; a <= 99; a++) {
      for (let b = 1; b <= 9; b++) {
        problems.push({ text: `${a} － ${b} = ?`, answer: a - b });
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

  let entries = loadHistory().filter((h) => h.name === player);
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
  document.getElementById("quiz-question").textContent = problem.text;
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "quiz-feedback";
  renderAnswerDisplay();
  updateQuizStatus();
}

function handleKeyPress(key) {
  if (!state) return;
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
  if (!state || state.inputBuffer.length === 0) return;
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
  if (state.timerHandle) clearInterval(state.timerHandle);
  const totalAnswered = state.correct + state.wrong;
  const accuracy = totalAnswered > 0 ? Math.round((state.correct / totalAnswered) * 100) : 0;
  const elapsedSec = Math.round((Date.now() - state.startedAt) / 1000);

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
  };
  saveHistoryEntry(entry);

  renderResult(entry);
  showScreen("screen-result");
}

function renderResult(entry) {
  document.getElementById("result-title").textContent =
    entry.mode === "timeattack" ? "タイムアタック けっか" : "けっか";

  const levelInfo = LEVELS.find((l) => l.id === entry.level);
  document.getElementById("result-stats").innerHTML = `
    <div class="big">${entry.correct} もん せいかい！</div>
    <div>せいかいりつ: ${entry.accuracy}%</div>
    <div>といたもんすう: ${entry.total}もん (まちがい ${entry.wrong}もん)</div>
    <div>レベル: ${entry.level} (${levelInfo ? levelInfo.hint : ""})</div>
    ${entry.mode === "timeattack" ? `<div>せいげんじかん: ${entry.timeLimit}びょう</div>` : `<div>かかったじかん: ${entry.elapsedSec}びょう</div>`}
  `;
}

// ===== 初期化 =====
function enterStartScreen() {
  renderPlayerBar();
  renderRanking("all");
  showScreen("screen-start");
}

function init() {
  maybeResetHistory();
  renderLevelGrid();

  if (getCurrentPlayer()) {
    enterStartScreen();
  } else {
    showScreen("screen-player");
  }

  document.getElementById("player-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("player-name-input");
    const name = input.value.trim().slice(0, 10);
    if (!name) return;
    setCurrentPlayer(name);
    input.value = "";
    enterStartScreen();
  });

  document.getElementById("btn-switch-player").addEventListener("click", () => {
    clearCurrentPlayer();
    showScreen("screen-player");
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
