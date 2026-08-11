// ===== レベル設定 =====
const LEVELS = [
  { id: 1, label: "レベル1", hint: "1年生くらい",
    add: [1, 9], sub: [1, 9], mulA: [1, 5], mulB: [1, 5], divB: [1, 5], divQ: [1, 5] },
  { id: 2, label: "レベル2", hint: "2年生くらい",
    add: [1, 99], sub: [1, 99], mulA: [1, 9], mulB: [1, 9], divB: [1, 9], divQ: [1, 9] },
  { id: 3, label: "レベル3", hint: "3年生くらい",
    add: [1, 999], sub: [1, 999], mulA: [10, 99], mulB: [2, 9], divB: [2, 9], divQ: [10, 99] },
  { id: 4, label: "レベル4", hint: "4年生くらい",
    add: [1, 9999], sub: [1, 9999], mulA: [10, 99], mulB: [10, 99], divB: [2, 99], divQ: [2, 99] },
  { id: 5, label: "レベル5", hint: "5年生くらい",
    add: [1, 99999], sub: [1, 99999], mulA: [100, 999], mulB: [2, 99], divB: [2, 99], divQ: [100, 999] },
  { id: 6, label: "レベル6", hint: "6年生くらい",
    add: [1, 999999], sub: [1, 999999], mulA: [100, 999], mulB: [100, 999], divB: [10, 999], divQ: [10, 999] },
];

const OP_LABEL = { add: "＋", sub: "－", mul: "×", div: "÷" };
const HISTORY_KEY = "mathapp_history";

// ===== 状態 =====
let state = null;

// ===== ユーティリティ =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function generateProblem(level, operators) {
  const op = pick(operators);
  const cfg = LEVELS.find((l) => l.id === level);
  let a, b, answer, text;

  if (op === "add") {
    a = randInt(...cfg.add);
    b = randInt(...cfg.add);
    answer = a + b;
    text = `${a} ＋ ${b}`;
  } else if (op === "sub") {
    a = randInt(...cfg.sub);
    b = randInt(...cfg.sub);
    if (a < b) [a, b] = [b, a];
    answer = a - b;
    text = `${a} － ${b}`;
  } else if (op === "mul") {
    a = randInt(...cfg.mulA);
    b = randInt(...cfg.mulB);
    answer = a * b;
    text = `${a} × ${b}`;
  } else {
    const divisor = randInt(...cfg.divB);
    const quotient = randInt(...cfg.divQ);
    const dividend = divisor * quotient;
    answer = quotient;
    text = `${dividend} ÷ ${divisor}`;
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

function saveHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
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

function getSelectedOperators() {
  return Array.from(document.querySelectorAll("#op-grid input:checked")).map((i) => i.value);
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
      return `<div class="history-item">
        <span>${formatDate(h.date)} / Lv${h.level} / ${modeLabel}</span>
        <span>${h.correct}問正解 (${h.accuracy}%)</span>
      </div>`;
    })
    .join("");
}

// ===== クイズ開始 =====
function startQuiz() {
  const level = getSelectedLevel();
  const operators = getSelectedOperators();
  if (operators.length === 0) {
    alert("けいさんのしゅるいを1つ以上えらんでね");
    return;
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;

  state = {
    level,
    operators,
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

function nextQuestion() {
  if (state.mode === "normal" && state.index >= state.total) {
    finishQuiz();
    return;
  }
  const problem = generateProblem(state.level, state.operators);
  state.currentAnswer = problem.answer;
  document.getElementById("quiz-question").textContent = problem.text;
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "quiz-feedback";
  const input = document.getElementById("quiz-answer");
  input.value = "";
  input.focus();
  updateQuizStatus();
}

function handleAnswerSubmit(e) {
  e.preventDefault();
  if (!state) return;
  const input = document.getElementById("quiz-answer");
  const value = Number(input.value);
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
    date: new Date().toISOString(),
    level: state.level,
    mode: state.mode,
    operators: state.operators,
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

  const opsLabel = entry.operators.map((o) => OP_LABEL[o]).join(" ");
  document.getElementById("result-stats").innerHTML = `
    <div class="big">${entry.correct} もん せいかい！</div>
    <div>せいかいりつ: ${entry.accuracy}%</div>
    <div>といたもんすう: ${entry.total}もん (まちがい ${entry.wrong}もん)</div>
    <div>レベル: ${entry.level} / けいさん: ${opsLabel}</div>
    ${entry.mode === "timeattack" ? `<div>せいげんじかん: ${entry.timeLimit}びょう</div>` : `<div>かかったじかん: ${entry.elapsedSec}びょう</div>`}
  `;
}

// ===== 初期化 =====
function init() {
  renderLevelGrid();
  renderHistory();

  document.getElementById("btn-start").addEventListener("click", startQuiz);
  document.getElementById("quiz-form").addEventListener("submit", handleAnswerSubmit);
  document.getElementById("btn-retry").addEventListener("click", startQuiz);
  document.getElementById("btn-back").addEventListener("click", () => {
    renderHistory();
    showScreen("screen-start");
  });
}

document.addEventListener("DOMContentLoaded", init);
