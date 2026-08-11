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
const MAX_ANSWER_DIGITS = 3;

// ===== 状態 =====
let state = null;
let currentEntryId = null;

// ===== ユーティリティ =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateProblem(level) {
  let a, b, answer, text;

  if (level === 1) {
    // 1桁 + 1桁、こたえも1桁 (合計が9以下)
    a = randInt(1, 8);
    b = randInt(1, 9 - a);
    answer = a + b;
    text = `${a} ＋ ${b}`;
  } else if (level === 2) {
    // 1桁 + 1桁、こたえは2桁 (合計が10以上)
    a = randInt(1, 9);
    const minB = Math.max(1, 10 - a);
    b = randInt(minB, 9);
    answer = a + b;
    text = `${a} ＋ ${b}`;
  } else if (level === 3) {
    // 1桁同士のひきざん、こたえは0以上
    a = randInt(0, 9);
    b = randInt(0, 9);
    if (a < b) [a, b] = [b, a];
    answer = a - b;
    text = `${a} － ${b}`;
  } else {
    // 2桁から1桁をひく
    a = randInt(10, 99);
    b = randInt(1, 9);
    answer = a - b;
    text = `${a} － ${b}`;
  }

  return { text: `${text} = ?`, answer };
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

function updateHistoryEntryName(id, name) {
  const history = loadHistory();
  const entry = history.find((h) => h.id === id);
  if (entry) {
    entry.name = name;
    saveHistory(history);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

function renderHistory() {
  const list = document.getElementById("history-list");
  const history = loadHistory();
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">まだきろくがないよ</div>';
    return;
  }
  list.innerHTML = history
    .map((h) => {
      const modeLabel = h.mode === "timeattack" ? `タイムアタック${h.timeLimit}秒` : `${h.total}もん`;
      const nameLabel = h.name ? `${h.name} / ` : "";
      return `<div class="history-item">
        <span>${nameLabel}${formatDate(h.date)} / Lv${h.level} / ${modeLabel}</span>
        <span>${h.correct}問正解 (${h.accuracy}%)</span>
      </div>`;
    })
    .join("");
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
  const problem = generateProblem(state.level);
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
  } else {
    state.wrong += 1;
    feedback.textContent = `ざんねん… こたえは ${state.currentAnswer}`;
    feedback.className = "quiz-feedback wrong";
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
    name: "",
    total: totalAnswered,
    correct: state.correct,
    wrong: state.wrong,
    accuracy,
    timeLimit: state.timeLimit,
    elapsedSec,
  };
  saveHistoryEntry(entry);
  currentEntryId = entry.id;

  renderResult(entry);
  resetNameEntry();
  showScreen("screen-result");
}

function resetNameEntry() {
  document.getElementById("name-entry").hidden = false;
  document.getElementById("name-saved-msg").hidden = true;
  document.getElementById("player-name").value = "";
}

function handleNameSubmit(e) {
  e.preventDefault();
  if (currentEntryId === null) return;
  const nameInput = document.getElementById("player-name");
  const name = nameInput.value.trim().slice(0, 10);
  if (!name) return;
  updateHistoryEntryName(currentEntryId, name);
  document.getElementById("name-entry").hidden = true;
  document.getElementById("name-saved-msg").hidden = false;
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
function init() {
  renderLevelGrid();
  renderHistory();

  document.getElementById("btn-start").addEventListener("click", startQuiz);
  document.getElementById("keypad").addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    handleKeyPress(btn.dataset.key);
  });
  document.getElementById("name-entry").addEventListener("submit", handleNameSubmit);
  document.getElementById("btn-retry").addEventListener("click", startQuiz);
  document.getElementById("btn-back").addEventListener("click", () => {
    renderHistory();
    showScreen("screen-start");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
