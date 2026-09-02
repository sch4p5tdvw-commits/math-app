"use strict";

// ===== 定数 =====
const STORE_KEY = "jphistory-v1";
const ORDER_COUNT = 5; // 並べかえで出す数
const CLOZE_COUNT = 5; // 穴うめで出す数
const TOTAL_Q = 2 + CLOZE_COUNT; // 並べかえ2問＋穴うめ5問

const LEVELS = [
  {
    id: "es",
    label: "小学生",
    hint: "小学校で習う、よく知られた出来事から出します。時代の名前にはよみがなをつけます。"
  },
  {
    id: "jhs",
    label: "中学生",
    hint: "中学校で習う内容まで出します。制度や条約の名前も出てくるので、しっかりおぼえよう。"
  }
];

const PRESETS = [
  { id: "all", label: "ぜんぶ", eras: null },
  { id: "kodai", label: "原始・古代", eras: ["jomon", "yayoi", "kofun", "asuka", "nara", "heian"] },
  { id: "bushi", label: "武士の世", eras: ["heian", "kamakura", "muromachi", "azuchi", "edo"] },
  { id: "kingendai", label: "近現代", eras: ["edo", "meiji", "taisho", "showa", "heisei"] }
];

const ALL_ERA_IDS = ERAS.map((e) => e.id);

// ===== 状態 =====
let state = {
  level: "jhs",
  eras: ALL_ERA_IDS.slice(),
  stats: {
    es: { best: 0, current: 0, plays: 0, perfect: 0 },
    jhs: { best: 0, current: 0, plays: 0, perfect: 0 }
  }
};

let session = null;
let audioCtx = null;
let confettiHandle = null;

// ===== 小さな道具 =====
const $ = (id) => document.getElementById(id);

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = (list, n) => shuffle(list).slice(0, n);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const eraById = (id) => ERAS.find((e) => e.id === id);

// ===== 保存 =====
function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch (err) {
    saved = null;
  }
  if (!saved) return;

  if (saved.level === "es" || saved.level === "jhs") state.level = saved.level;
  if (Array.isArray(saved.eras)) {
    const kept = saved.eras.filter((id) => ALL_ERA_IDS.includes(id));
    if (kept.length >= ORDER_COUNT) state.eras = kept;
  }
  ["es", "jhs"].forEach((key) => {
    const s = saved.stats && saved.stats[key];
    if (!s) return;
    const target = state.stats[key];
    ["best", "current", "plays", "perfect"].forEach((f) => {
      if (typeof s[f] === "number" && s[f] >= 0) target[f] = Math.floor(s[f]);
    });
    // 記録より今の連続が大きい状態はありえないので、そろえておく
    if (target.current > target.best) target.best = target.current;
  });
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    // 保存できなくても遊べるようにする（シークレットモードなど）
  }
}

const stats = () => state.stats[state.level];
const levelInfo = () => LEVELS.find((l) => l.id === state.level);

// ===== 音 =====
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
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

function playCorrectSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.14, "sine", 0.22);
  playTone(ctx, 1175, now + 0.13, 0.24, "sine", 0.22);
}

function playWrongSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 220, now, 0.22, "triangle", 0.18);
  playTone(ctx, 165, now + 0.16, 0.3, "triangle", 0.18);
}

function playFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 1500, now, 0.06, "square", 0.12); // パンッ
  [523, 659, 784, 1047].forEach((freq, i) => {
    playTone(ctx, freq, now + 0.08 + i * 0.1, 0.24, "triangle", 0.2);
  });
}

// ===== クラッカー =====
function celebrate() {
  playFanfare();
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = $("confetti");
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.hidden = false;

  const colors = ["#c8503c", "#2f5c92", "#c8a45c", "#2e7d5b", "#e0568c", "#f0b429"];
  const pieces = [];
  [
    { x: 10, y: h - 10, dir: 1 },
    { x: w - 10, y: h - 10, dir: -1 }
  ].forEach((origin) => {
    for (let i = 0; i < 70; i++) {
      const angle = (-70 + Math.random() * 45) * (Math.PI / 180);
      const speed = 11 + Math.random() * 11;
      pieces.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle) * speed * origin.dir,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  });

  if (confettiHandle) cancelAnimationFrame(confettiHandle);
  const startedAt = performance.now();

  const frame = (now) => {
    const life = now - startedAt;
    ctx.clearRect(0, 0, w, h);
    pieces.forEach((p) => {
      p.vy += 0.32; // じゅうりょく
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - life / 2600);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (life < 2600) {
      confettiHandle = requestAnimationFrame(frame);
    } else {
      confettiHandle = null;
      ctx.clearRect(0, 0, w, h);
      canvas.hidden = true;
    }
  };
  confettiHandle = requestAnimationFrame(frame);
}

function stopCelebration() {
  if (confettiHandle) {
    cancelAnimationFrame(confettiHandle);
    confettiHandle = null;
  }
  $("confetti").hidden = true;
}

// ===== 画面切りかえ =====
function showScreen(name) {
  ["home", "quiz", "result"].forEach((key) => {
    $(`screen-${key}`).hidden = key !== name;
  });
  window.scrollTo(0, 0);
}

// ===== ホーム画面 =====
function eventsForLevel(era, levelId) {
  return levelId === "es" ? era.events.filter((ev) => ev.level === "e") : era.events.slice();
}

function renderRecordCard() {
  const s = stats();
  $("record-level-tag").textContent = levelInfo().label;
  $("record-best").textContent = s.best;
  $("record-current").textContent = s.current;

  const ratio = s.best > 0 ? Math.min(s.current / s.best, 1) : s.current > 0 ? 1 : 0;
  $("streak-bar-fill").style.width = `${ratio * 100}%`;

  let hint;
  if (s.best === 0) {
    hint = "まずは 3問れんぞく せいかいを目指そう！";
  } else if (s.current === 0) {
    hint = `記録は ${s.best}問。ここから また つみ上げよう！`;
  } else if (s.current >= s.best) {
    hint = "いま自己記録を こうしん中！このまま つづけよう！";
  } else {
    hint = `あと ${s.best - s.current}問 れんぞくで 自己新記録！`;
  }
  $("record-hint").textContent = hint;
}

function renderLevelChips() {
  const box = $("level-chips");
  box.innerHTML = "";
  LEVELS.forEach((lv) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.level === lv.id ? " selected" : "");
    btn.textContent = lv.label;
    btn.addEventListener("click", () => {
      state.level = lv.id;
      save();
      renderHome();
    });
    box.appendChild(btn);
  });
  $("level-hint").textContent = levelInfo().hint;
}

function currentPresetId() {
  const selected = state.eras.slice().sort().join(",");
  const found = PRESETS.find((p) => {
    const ids = (p.eras || ALL_ERA_IDS).slice().sort().join(",");
    return ids === selected;
  });
  return found ? found.id : null;
}

function renderPresetChips() {
  const box = $("preset-chips");
  box.innerHTML = "";
  const active = currentPresetId();
  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (active === preset.id ? " selected" : "");
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      state.eras = (preset.eras || ALL_ERA_IDS).slice();
      save();
      renderHome();
    });
    box.appendChild(btn);
  });
}

function renderEraGrid() {
  const box = $("era-grid");
  box.innerHTML = "";
  ERAS.forEach((era) => {
    const on = state.eras.includes(era.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "era-toggle" + (on ? " on" : "");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    // 「じだい」まで出すと横にはみ出す時代があるので、ここでは省く
    btn.innerHTML = `${era.name}<span class="era-yomi">${era.yomi.replace(/じだい$/, "")}</span>`;
    btn.addEventListener("click", () => {
      if (on) {
        state.eras = state.eras.filter((id) => id !== era.id);
      } else {
        state.eras = ERAS.filter((e) => e.id === era.id || state.eras.includes(e.id)).map((e) => e.id);
      }
      save();
      renderHome();
    });
    box.appendChild(btn);
  });
}

function renderHome() {
  renderRecordCard();
  renderLevelChips();
  renderPresetChips();
  renderEraGrid();

  const enough = state.eras.length >= ORDER_COUNT;
  $("btn-start").disabled = !enough;
  $("range-hint").textContent = enough
    ? `${state.eras.length}つの時代から出題します。この中の1つの時代について、出来事の問題が出ます。`
    : `時代を ${ORDER_COUNT}つ以上えらんでね（いま ${state.eras.length}つ）。`;
}

// ===== 出題づくり =====
function buildSession() {
  const pool = ERAS.filter((e) => state.eras.includes(e.id));
  const orderEras = sample(pool, ORDER_COUNT);

  // 出来事の問題を出せる（その難易度で5つ以上の出来事がある）時代をえらぶ。
  // 並べかえに出した5つの時代の中から選ぶのを優先する。
  const canUse = (era) => eventsForLevel(era, state.level).length >= CLOZE_COUNT;
  let candidates = orderEras.filter(canUse);
  if (!candidates.length) candidates = pool.filter(canUse);
  if (!candidates.length) candidates = pool.filter((e) => e.events.length >= CLOZE_COUNT);

  const era = pickOne(candidates);
  const usableEvents = eventsForLevel(era, state.level);
  const source = usableEvents.length >= CLOZE_COUNT ? usableEvents : era.events;
  const events = sample(source, CLOZE_COUNT).sort((a, b) => a.sort - b.sort);

  const questions = [];

  questions.push({
    kind: "order",
    label: "ならべかえ ①",
    title: "5つの時代を 古いじゅんに ならべよう",
    note: "古いとおもうものから じゅんにタップしてね。",
    items: shuffle(
      orderEras.map((e) => ({
        key: e.id,
        label: e.name,
        sub: state.level === "es" ? e.yomi : "",
        when: e.span
      }))
    ),
    correctKeys: orderEras.slice().sort((a, b) => a.start - b.start).map((e) => e.id),
    picks: []
  });

  questions.push({
    kind: "order",
    label: "ならべかえ ②",
    title: `${era.name}の 出来事を 古いじゅんに ならべよう`,
    note: `ここからは ${era.name}（${era.span}）の問題です。`,
    items: shuffle(
      events.map((ev) => ({
        key: ev.id,
        label: ev.text,
        sub: "",
        when: ev.when
      }))
    ),
    correctKeys: events.map((ev) => ev.id),
    picks: []
  });

  events.forEach((ev, i) => {
    questions.push({
      kind: "cloze",
      label: `穴うめ ${i + 1}／${CLOZE_COUNT}`,
      era,
      event: ev,
      choices: shuffle([ev.q.a].concat(ev.q.w)),
      pick: null
    });
  });

  session = {
    level: state.level,
    era,
    questions,
    index: 0,
    correct: 0,
    results: [],
    bestAtStart: stats().best,
    newRecord: false,
    answered: false
  };
}

// ===== 出題画面 =====
function renderQuizBar() {
  const s = stats();
  $("quiz-progress").textContent = `${session.index + 1} / ${TOTAL_Q}`;
  $("quiz-streak").textContent = `🔥 ${s.current}`;
  $("quiz-best").textContent = `最高 ${s.best}`;
  $("quiz-record-flag").hidden = !(s.current > session.bestAtStart);

  const dots = $("quiz-dots");
  dots.innerHTML = "";
  session.questions.forEach((q, i) => {
    const dot = document.createElement("span");
    let cls = "dot";
    if (i < session.results.length) cls += session.results[i].correct ? " ok" : " ng";
    else if (i === session.index) cls += " now";
    dot.className = cls;
    dots.appendChild(dot);
  });
}

function clozeTitleHtml(q, filled) {
  const parts = q.event.q.text.split("（　）");
  const blank = filled
    ? `<span class="blank filled">${q.event.q.a}</span>`
    : `<span class="blank">？</span>`;
  return `${parts[0]}${blank}${parts[1] || ""}`;
}

function renderOrderBody(q) {
  const body = $("q-body");
  body.innerHTML = "";

  const axis = document.createElement("div");
  axis.className = "order-axis";
  axis.innerHTML = "<span>①が いちばん古い</span><span>⑤が いちばん新しい</span>";
  body.appendChild(axis);

  const list = document.createElement("div");
  list.className = "order-list";
  body.appendChild(list);

  const draw = () => {
    list.innerHTML = "";
    q.items.forEach((item) => {
      const at = q.picks.indexOf(item.key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "order-item" + (at >= 0 ? " picked" : "");
      btn.innerHTML =
        `<span class="order-badge">${at >= 0 ? at + 1 : "－"}</span>` +
        `<span>${item.label}${item.sub ? `<span class="era-yomi">${item.sub}</span>` : ""}</span>`;
      btn.addEventListener("click", () => {
        if (session.answered) return;
        if (at >= 0) q.picks.splice(at, 1);
        else if (q.picks.length < q.items.length) q.picks.push(item.key);
        draw();
        $("btn-answer").disabled = q.picks.length !== q.items.length;
      });
      list.appendChild(btn);
    });

    if (session.answered) {
      list.classList.add("locked");
      return;
    }

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "order-reset";
    reset.textContent = "じゅんばんを やりなおす";
    reset.addEventListener("click", () => {
      if (session.answered) return;
      q.picks = [];
      draw();
      $("btn-answer").disabled = true;
    });
    list.appendChild(reset);
  };

  draw();
}

function renderClozeBody(q) {
  const body = $("q-body");
  body.innerHTML = "";

  const box = document.createElement("div");
  box.className = "choices";
  body.appendChild(box);

  q.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice";
    btn.dataset.choice = choice;
    btn.innerHTML = `<span class="mark">${i + 1}</span><span>${choice}</span>`;
    btn.addEventListener("click", () => {
      if (session.answered) return;
      q.pick = choice;
      box.querySelectorAll(".choice").forEach((el) => {
        el.classList.toggle("selected", el.dataset.choice === choice);
      });
      $("btn-answer").disabled = false;
    });
    box.appendChild(btn);
  });
}

function renderQuestion() {
  const q = session.questions[session.index];
  session.answered = false;

  renderQuizBar();
  $("q-feedback").hidden = true;
  $("btn-answer").hidden = false;
  $("btn-next").hidden = true;
  $("q-kind").textContent = q.label;

  if (q.kind === "order") {
    $("q-title").textContent = q.title;
    $("q-note").textContent = q.note;
    $("btn-answer").disabled = q.picks.length !== q.items.length;
    renderOrderBody(q);
  } else {
    $("q-title").innerHTML = clozeTitleHtml(q, false);
    $("q-note").textContent = `${q.era.name}・${q.event.when}のできごと`;
    $("btn-answer").disabled = q.pick === null;
    renderClozeBody(q);
  }
}

function orderAnswerHtml(q) {
  const rows = q.correctKeys
    .map((key, i) => {
      const item = q.items.find((it) => it.key === key);
      const ok = q.picks[i] === key;
      return (
        `<li><span class="no">${i + 1}</span>` +
        `<span>${item.label}<span class="year">${item.when}</span></span>` +
        `<span class="judge ${ok ? "ok" : "ng"}">${ok ? "○" : "×"}</span></li>`
      );
    })
    .join("");
  return `<ul class="answer-list">${rows}</ul>`;
}

function showFeedback(q, correct) {
  const box = $("q-feedback");
  box.className = "feedback " + (correct ? "ok" : "ng");
  const head = correct ? "○ せいかい！" : "× おしい…";

  let inner = `<p class="feedback-head">${head}</p>`;
  if (q.kind === "order") {
    inner += `<p class="feedback-exp">正しいじゅんばんはこちら。</p>${orderAnswerHtml(q)}`;
  } else {
    inner += `<p class="feedback-exp">こたえ：<strong>${q.event.q.a}</strong></p>`;
    inner += `<p class="feedback-exp">${q.event.q.exp}</p>`;
  }
  box.innerHTML = inner;
  box.hidden = false;
}

function judge() {
  const q = session.questions[session.index];
  if (session.answered) return;

  let correct;
  if (q.kind === "order") {
    correct = q.correctKeys.every((key, i) => q.picks[i] === key);
    const list = document.querySelector("#q-body .order-list");
    if (list) {
      list.classList.add("locked");
      const reset = list.querySelector(".order-reset");
      if (reset) reset.remove();
    }
  } else {
    correct = q.pick === q.event.q.a;
    // 4択のボタンに ○×を表示する
    document.querySelectorAll("#q-body .choice").forEach((el) => {
      el.disabled = true;
      el.classList.remove("selected");
      if (el.dataset.choice === q.event.q.a) el.classList.add("correct");
      else if (el.dataset.choice === q.pick) el.classList.add("wrong");
    });
    $("q-title").innerHTML = clozeTitleHtml(q, true);
  }

  session.answered = true;
  if (correct) session.correct += 1;
  session.results.push({
    correct,
    title: q.kind === "order" ? q.title : q.event.q.text.replace("（　）", "（　　）"),
    answer: q.kind === "order" ? q.correctKeys.map((k, i) => `${i + 1}. ${q.items.find((it) => it.key === k).label}`).join(" → ") : q.event.q.a
  });

  // 連続正解の記録を、1問ごとにその場で更新する
  const s = stats();
  if (correct) {
    s.current += 1;
    if (s.current > s.best) {
      s.best = s.current;
      session.newRecord = true;
    }
  } else {
    s.current = 0;
  }
  save();

  if (correct) playCorrectSound();
  else playWrongSound();

  showFeedback(q, correct);
  renderQuizBar();
  $("btn-answer").hidden = true;
  $("btn-next").hidden = false;
  $("btn-next").textContent = session.index === TOTAL_Q - 1 ? "けっかを見る" : "つぎへ";
}

function nextQuestion() {
  if (session.index >= TOTAL_Q - 1) {
    finishSession();
    return;
  }
  session.index += 1;
  renderQuestion();
}

// ===== 結果画面 =====
function finishSession() {
  const s = stats();
  const perfect = session.correct === TOTAL_Q;
  s.plays += 1;
  if (perfect) s.perfect += 1;
  save();

  $("result-emoji").textContent = perfect ? "🎉🎊🎉" : session.correct >= 5 ? "👏" : "📚";
  $("result-title").textContent = perfect ? "ぜんもん せいかい！" : "けっか";
  $("result-score").textContent = session.correct;

  let message;
  if (perfect) {
    message = `おめでとう！${session.era.name}も バッチリだね！`;
  } else if (session.correct >= 5) {
    message = "あと少し！まちがえたところを 見なおそう。";
  } else {
    message = "だいじょうぶ。くり返せば 歴史の流れが 見えてくるよ。";
  }
  $("result-message").textContent = message;

  let streakHtml = `連続正解 <span class="big">${s.current}</span>問 ／ 最大連続正解記録 <span class="big">${s.best}</span>問`;
  if (session.newRecord) {
    streakHtml += `<br><span class="new-record">🏅 自己新記録 ${s.best}問！</span>`;
  }
  if (s.current === 0) {
    streakHtml += `<br>まちがえると 0にもどります。つぎは ${s.best + 1}問れんぞくを ねらおう！`;
  } else if (s.current >= s.best) {
    streakHtml += `<br>このまま つづければ どんどん記録がのびるよ！`;
  } else {
    streakHtml += `<br>あと ${s.best - s.current + 1}問 れんぞくで 自己新記録！`;
  }
  $("result-streak").innerHTML = streakHtml;

  const missed = session.results.filter((r) => !r.correct);
  const review = $("result-review");
  if (missed.length) {
    review.innerHTML =
      "<h3>まちがえた問題</h3>" +
      missed
        .map(
          (r) =>
            `<div class="review-item"><div class="review-q">${r.title}</div>` +
            `<div class="review-a">こたえ：${r.answer}</div></div>`
        )
        .join("");
  } else {
    review.innerHTML = "";
  }

  showScreen("result");
  if (perfect || session.newRecord) celebrate();
}

// ===== 起動 =====
function startQuiz() {
  if (state.eras.length < ORDER_COUNT) return;
  getAudioContext(); // 最初のタップで音を使えるようにする
  stopCelebration();
  buildSession();
  showScreen("quiz");
  renderQuestion();
}

function goHome() {
  stopCelebration();
  session = null;
  renderHome();
  showScreen("home");
}

function init() {
  load();
  renderHome();
  showScreen("home");

  $("btn-start").addEventListener("click", startQuiz);
  $("btn-answer").addEventListener("click", judge);
  $("btn-next").addEventListener("click", nextQuestion);
  $("btn-quit").addEventListener("click", goHome);
  $("btn-again").addEventListener("click", startQuiz);
  $("btn-home").addEventListener("click", goHome);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

init();
