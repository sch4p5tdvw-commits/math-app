// ===== 麻雀スコア計算アプリ =====
// 4〜6人のメンバーで遊ぶことを想定し、常に4人が着席、残りは待機列で待つ。
// データはすべて localStorage（この端末のブラウザ内）だけに保存する。

const STORAGE_KEY = "mahjongScorerState_v1";
const ARCHIVE_KEY = "mahjongScorerArchive_v1";
const MEMBERS_KEY = "mahjongScorerMembers_v1";
const DEFAULT_START_POINTS = 25000;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;
const ROUND_NAMES = ["東", "南", "西", "北"];

let state = null;

// ---------- ユーティリティ ----------

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function formatPoints(n) {
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("ja-JP");
}

function roundUp100(x) {
  return Math.ceil(x / 100) * 100;
}

function getPlayer(id) {
  return state.players.find((p) => p.id === id);
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- 永続化 ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
  state = null;
}

function loadArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveArchive(archive) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
}

// 対局を終了するときに、そのときの記録をまるごと保存しておく
function archiveCurrentSession() {
  const results = state.players.map((p) => ({ name: p.name, score: p.score, diff: p.score - state.settings.startPoints }));
  const hands = state.history.map((h) => ({ time: h.time, summary: h.summary }));
  const entry = {
    id: uid(),
    endedAt: Date.now(),
    startPoints: state.settings.startPoints,
    results,
    hands,
  };
  const archive = loadArchive();
  archive.unshift(entry);
  saveArchive(archive);
}

// ---------- 得点計算 ----------

// 1〜4翻は符から基本点を計算。5翻以上は符に関係ない固定表を使う。
function calcBase(han, fu, kiriageMangan, yakumanMulti) {
  if (han >= 13) return { base: 8000 * (yakumanMulti || 1), label: (yakumanMulti > 1 ? yakumanMulti + "倍" : "") + "役満" };
  if (han >= 11) return { base: 6000, label: "三倍満" };
  if (han >= 8) return { base: 4000, label: "倍満" };
  if (han >= 6) return { base: 3000, label: "跳満" };
  if (han === 5) return { base: 2000, label: "満貫" };

  let base = fu * Math.pow(2, 2 + han);
  if (kiriageMangan && base >= 1920 && base < 2000) base = 2000;
  if (base > 2000) base = 2000;
  const label = base === 2000 ? "満貫" : "";
  return { base, label };
}

// 翻符から「本場をのぞいた」基本の支払い額を出す（直接入力モードでは
// この段階の金額をユーザーがそのまま入力できるようにする）
function ronBaseFromHanFu(base, isDealerWin) {
  const mult = isDealerWin ? 6 : 4;
  return roundUp100(base * mult);
}

function tsumoBaseFromHanFu(base, isDealerWin) {
  if (isDealerWin) return { type: "dealer", each: roundUp100(base * 2) };
  return { type: "nondealer", dealerPay: roundUp100(base * 2), otherPay: roundUp100(base * 1) };
}

// 基本の支払い額に本場（+300点/+100点）を乗せて最終の支払い額にする
function calcRonPayment(basePayment, honba) {
  return basePayment + honba * 300;
}

function calcTsumoPayments(basePayments, honba) {
  if (basePayments.type === "dealer") {
    return { type: "dealer", each: basePayments.each + honba * 100 };
  }
  return {
    type: "nondealer",
    dealerPay: basePayments.dealerPay + honba * 100,
    otherPay: basePayments.otherPay + honba * 100,
  };
}

// ---------- 席・親のヘルパー ----------

function seatWind(seatIndex) {
  const rel = (seatIndex - state.dealerSeatIndex + 4) % 4;
  return ROUND_NAMES[rel === 0 ? 0 : rel]; // 0:東(親) 1:南 2:西 3:北
}

function isDealerSeat(seatIndex) {
  return seatIndex === state.dealerSeatIndex;
}

function roundLabelText() {
  return `${ROUND_NAMES[state.round]}${state.kyoku}局`;
}

// 親を次の席へ送り、局・場を進める
function advanceDealer() {
  state.dealerSeatIndex = (state.dealerSeatIndex + 1) % 4;
  state.kyoku += 1;
  if (state.kyoku > 4) {
    state.kyoku = 1;
    state.round = (state.round + 1) % ROUND_NAMES.length;
  }
}

// ---------- 状態のスナップショット（取り消し用） ----------

function snapshotState() {
  return deepClone({
    players: state.players,
    seats: state.seats,
    waitingQueue: state.waitingQueue,
    dealerSeatIndex: state.dealerSeatIndex,
    round: state.round,
    kyoku: state.kyoku,
    honba: state.honba,
    pot: state.pot,
  });
}

function restoreSnapshot(snap) {
  state.players = snap.players;
  state.seats = snap.seats;
  state.waitingQueue = snap.waitingQueue;
  state.dealerSeatIndex = snap.dealerSeatIndex;
  state.round = snap.round;
  state.kyoku = snap.kyoku;
  state.honba = snap.honba;
  state.pot = snap.pot;
}

function pushHistory(entry, prevSnapshot) {
  state.history.push(Object.assign({ id: uid(), time: Date.now(), prevState: prevSnapshot }, entry));
}

// ---------- 手の確定処理 ----------

function applyRiichi(riichiSeatIndexes) {
  riichiSeatIndexes.forEach((seatIdx) => {
    const p = getPlayer(state.seats[seatIdx]);
    p.score -= 1000;
    state.pot += 1000;
  });
}

function finalizeRon({ winnerSeat, loserSeat, basePayment, label, riichiSeats }) {
  const prevSnapshot = snapshotState();
  applyRiichi(riichiSeats);

  const payment = calcRonPayment(basePayment, state.honba);
  const isDealerWin = isDealerSeat(winnerSeat);

  const winner = getPlayer(state.seats[winnerSeat]);
  const loser = getPlayer(state.seats[loserSeat]);
  const potWon = state.pot;

  loser.score -= payment;
  winner.score += payment + potWon;
  state.pot = 0;

  const dealerStays = isDealerWin;
  if (dealerStays) {
    state.honba += 1;
  } else {
    state.honba = 0;
    advanceDealer();
  }

  const summary = `${winner.name} が ${loser.name} から ${label}（${formatPoints(payment).slice(1)}点）ロン`;
  pushHistory(
    {
      type: "ron",
      summary,
      deltas: { [winner.id]: payment + potWon, [loser.id]: -payment },
    },
    prevSnapshot
  );
}

function finalizeTsumo({ winnerSeat, basePayments, label, riichiSeats }) {
  const prevSnapshot = snapshotState();
  applyRiichi(riichiSeats);

  const result = calcTsumoPayments(basePayments, state.honba);

  const winner = getPlayer(state.seats[winnerSeat]);
  const potWon = state.pot;
  let total = 0;
  const deltas = {};

  for (let i = 0; i < 4; i++) {
    if (i === winnerSeat) continue;
    const payer = getPlayer(state.seats[i]);
    const amount = result.type === "dealer" ? result.each : isDealerSeat(i) ? result.dealerPay : result.otherPay;
    payer.score -= amount;
    deltas[payer.id] = (deltas[payer.id] || 0) - amount;
    total += amount;
  }

  winner.score += total + potWon;
  deltas[winner.id] = (deltas[winner.id] || 0) + total + potWon;
  state.pot = 0;

  const dealerStays = isDealerSeat(winnerSeat);
  if (dealerStays) {
    state.honba += 1;
  } else {
    state.honba = 0;
    advanceDealer();
  }

  const summary = `${winner.name} が ${label}（合計${total.toLocaleString("ja-JP")}点）ツモ`;
  pushHistory({ type: "tsumo", summary, deltas }, prevSnapshot);
}

function finalizeDraw({ tenpaiSeats, riichiSeats }) {
  const prevSnapshot = snapshotState();
  applyRiichi(riichiSeats);

  const t = tenpaiSeats.length;
  const deltas = {};
  if (t > 0 && t < 4) {
    const payAmount = 3000 / (4 - t);
    const gainAmount = 3000 / t;
    for (let i = 0; i < 4; i++) {
      const p = getPlayer(state.seats[i]);
      if (tenpaiSeats.includes(i)) {
        p.score += gainAmount;
        deltas[p.id] = (deltas[p.id] || 0) + gainAmount;
      } else {
        p.score -= payAmount;
        deltas[p.id] = (deltas[p.id] || 0) - payAmount;
      }
    }
  }

  const dealerTenpai = tenpaiSeats.includes(state.dealerSeatIndex);
  state.honba += 1;
  if (!dealerTenpai) {
    advanceDealer();
    // 局・本場の連荘扱い：親流れのときも本場は積み上がる（advanceDealerでは変更しない）
  }

  const tenpaiNames = tenpaiSeats.map((i) => getPlayer(state.seats[i]).name);
  const summary = t === 0 ? "流局（全員ノーテン）" : t === 4 ? "流局（全員テンパイ）" : `流局（テンパイ: ${tenpaiNames.join("、")}）`;
  pushHistory({ type: "draw", summary, deltas }, prevSnapshot);
}

function applyManualAdjust(seatOrWaitingId, amount, note) {
  const prevSnapshot = snapshotState();
  const p = getPlayer(seatOrWaitingId);
  p.score += amount;
  const summary = `点数調整: ${p.name} ${formatPoints(amount)}点（${note || "理由なし"}）`;
  pushHistory({ type: "adjust", summary, deltas: { [p.id]: amount } }, prevSnapshot);
}

function undoLast() {
  const last = state.history.pop();
  if (!last) return;
  restoreSnapshot(last.prevState);
}

// ---------- 画面切り替え ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
  document.getElementById("modal-box").innerHTML = "";
}

function openModal(node) {
  const box = document.getElementById("modal-box");
  box.innerHTML = "";
  box.appendChild(node);
  document.getElementById("modal-overlay").hidden = false;
}

// ---------- セットアップ画面 ----------

// いつものメンバー。前回使った顔ぶれを覚えておき、まだ一度も対局して
// いなければこの初期メンバーを出す。
const DEFAULT_PLAYER_NAMES = ["ひろと", "ともみ", "ひな", "みう", "たつき", "けいた"];

function loadMemberNames() {
  try {
    const raw = localStorage.getItem(MEMBERS_KEY);
    if (!raw) return DEFAULT_PLAYER_NAMES.slice();
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_PLAYER_NAMES.slice();
    return list.slice(0, MAX_PLAYERS);
  } catch (e) {
    return DEFAULT_PLAYER_NAMES.slice();
  }
}

function saveMemberNames(names) {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(names));
}

let setupPlayers = [];

function renderSetupPlayerList() {
  const box = document.getElementById("setup-player-list");
  box.innerHTML = "";
  setupPlayers.forEach((name, idx) => {
    const chip = el(`
      <div class="player-chip">
        <span>${escapeHtml(name)}</span>
        <button class="chip-remove" aria-label="削除">×</button>
      </div>
    `);
    chip.querySelector(".chip-remove").addEventListener("click", () => {
      setupPlayers.splice(idx, 1);
      renderSetupPlayerList();
    });
    box.appendChild(chip);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function initSetupScreen() {
  setupPlayers = loadMemberNames();
  renderSetupPlayerList();

  const saved = loadState();
  if (saved && saved.started) {
    document.getElementById("setup-resume").hidden = false;
    document.getElementById("resume-btn").addEventListener("click", () => {
      state = saved;
      showScreen("screen-table");
      renderTable();
    });
  }

  document.getElementById("setup-player-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("setup-player-input");
    const name = input.value.trim();
    if (!name) return;
    if (setupPlayers.length >= MAX_PLAYERS) {
      showSetupError(`メンバーは最大${MAX_PLAYERS}人までです`);
      return;
    }
    setupPlayers.push(name);
    input.value = "";
    renderSetupPlayerList();
    hideSetupError();
  });

  document.getElementById("setup-start-btn").addEventListener("click", () => {
    if (setupPlayers.length < MIN_PLAYERS) {
      showSetupError(`メンバーは最低${MIN_PLAYERS}人必要です`);
      return;
    }
    const startPoints = Number(document.getElementById("setup-start-points").value) || DEFAULT_START_POINTS;
    const kiriage = document.getElementById("setup-kiriage").checked;
    saveMemberNames(setupPlayers);
    startNewSession(setupPlayers, startPoints, kiriage);
  });
}

function showSetupError(msg) {
  const e = document.getElementById("setup-error");
  e.textContent = msg;
  e.hidden = false;
}
function hideSetupError() {
  document.getElementById("setup-error").hidden = true;
}

function startNewSession(names, startPoints, kiriage) {
  const players = names.map((name) => ({ id: uid(), name, score: startPoints }));
  state = {
    players,
    seats: players.slice(0, 4).map((p) => p.id),
    waitingQueue: players.slice(4).map((p) => p.id),
    dealerSeatIndex: 0,
    round: 0,
    kyoku: 1,
    honba: 0,
    pot: 0,
    settings: { startPoints, kiriageMangan: kiriage },
    history: [],
    started: true,
  };
  saveState();
  showScreen("screen-table");
  renderTable();
}

// ---------- 卓画面 ----------

let swapSelection = null; // 待機列から選ばれたプレイヤーID
let archiveBackTarget = "screen-setup"; // 過去の記録画面から「戻る」で戻る先
let expandedArchiveIds = new Set(); // 過去の記録画面で詳細を開いている対局

function renderTable() {
  document.getElementById("round-label").textContent = roundLabelText();
  document.getElementById("honba-label").textContent = `${state.honba}本場`;
  document.getElementById("pot-label").textContent = state.pot;
  document.getElementById("btn-undo").disabled = state.history.length === 0;

  const grid = document.getElementById("seat-grid");
  grid.innerHTML = "";
  state.seats.forEach((pid, idx) => {
    const p = getPlayer(pid);
    const wind = seatWind(idx);
    const card = el(`
      <div class="seat-card ${isDealerSeat(idx) ? "seat-dealer" : ""}" data-seat="${idx}">
        <div class="seat-wind">${wind}${isDealerSeat(idx) ? "（親）" : ""}</div>
        <div class="seat-name">${escapeHtml(p.name)}</div>
        <div class="seat-score">${p.score.toLocaleString("ja-JP")}</div>
      </div>
    `);
    card.addEventListener("click", () => handleSeatClick(idx));
    grid.appendChild(card);
  });

  const waitingBox = document.getElementById("waiting-box");
  const waitingList = document.getElementById("waiting-list");
  waitingList.innerHTML = "";
  if (state.waitingQueue.length > 0) {
    waitingBox.hidden = false;
    state.waitingQueue.forEach((pid) => {
      const p = getPlayer(pid);
      const chip = el(`
        <button class="waiting-chip ${swapSelection === pid ? "waiting-chip-selected" : ""}" data-id="${pid}">
          ${escapeHtml(p.name)}（${p.score.toLocaleString("ja-JP")}）
        </button>
      `);
      chip.addEventListener("click", () => {
        swapSelection = swapSelection === pid ? null : pid;
        renderTable();
      });
      waitingList.appendChild(chip);
    });
  } else {
    waitingBox.hidden = true;
  }

  saveState();
}

function handleSeatClick(seatIdx) {
  if (!swapSelection) return;
  const outgoingId = state.seats[seatIdx];
  const incomingId = swapSelection;
  state.seats[seatIdx] = incomingId;
  state.waitingQueue = state.waitingQueue.filter((id) => id !== incomingId);
  state.waitingQueue.push(outgoingId);
  swapSelection = null;
  renderTable();
}

function activePlayers() {
  return state.seats.map((id) => getPlayer(id));
}

// ---------- モーダル: ロン/ツモ 共通の翻符入力 ----------

function buildHanFuPicker(container, onChange) {
  let han = 3;
  let fu = 30;
  let yakumanMulti = 1;

  container.innerHTML = `
    <div class="picker-row">
      <label>翻数</label>
      <div class="stepper">
        <button type="button" class="step-btn" data-dir="-1">－</button>
        <span class="step-value" id="han-value">3翻</span>
        <button type="button" class="step-btn" data-dir="1">＋</button>
      </div>
    </div>
    <div class="picker-row" id="fu-row">
      <label>符</label>
      <div id="fu-buttons" class="fu-buttons"></div>
    </div>
    <div class="picker-row" id="yakuman-row" hidden>
      <label>役満の数</label>
      <div class="stepper">
        <button type="button" class="step-btn" data-ydir="-1">－</button>
        <span class="step-value" id="yakuman-value">1倍</span>
        <button type="button" class="step-btn" data-ydir="1">＋</button>
      </div>
    </div>
    <div class="mangan-buttons" id="mangan-buttons"></div>
  `;

  const MANGAN_PRESETS = [
    { label: "満貫", han: 5 },
    { label: "跳満", han: 6 },
    { label: "倍満", han: 8 },
    { label: "三倍満", han: 11 },
    { label: "役満", han: 13 },
  ];
  const manganBox = container.querySelector("#mangan-buttons");
  MANGAN_PRESETS.forEach((preset) => {
    const b = el(`<button type="button" class="mangan-btn">${preset.label}</button>`);
    b.addEventListener("click", () => {
      han = preset.han;
      refreshHanLabel();
      emit();
    });
    manganBox.appendChild(b);
  });

  const FU_OPTIONS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  const fuButtonsBox = container.querySelector("#fu-buttons");
  FU_OPTIONS.forEach((f) => {
    const b = el(`<button type="button" class="fu-btn" data-fu="${f}">${f}</button>`);
    if (f === fu) b.classList.add("fu-btn-selected");
    b.addEventListener("click", () => {
      fu = f;
      fuButtonsBox.querySelectorAll(".fu-btn").forEach((x) => x.classList.remove("fu-btn-selected"));
      b.classList.add("fu-btn-selected");
      emit();
    });
    fuButtonsBox.appendChild(b);
  });

  function refreshHanLabel() {
    container.querySelector("#han-value").textContent = han >= 13 ? "役満" : han + "翻";
    container.querySelector("#fu-row").hidden = han >= 5;
    container.querySelector("#yakuman-row").hidden = han < 13;
  }

  container.querySelectorAll(".step-btn[data-dir]").forEach((b) => {
    b.addEventListener("click", () => {
      const dir = Number(b.dataset.dir);
      han = Math.min(13, Math.max(1, han + dir));
      refreshHanLabel();
      emit();
    });
  });
  container.querySelectorAll(".step-btn[data-ydir]").forEach((b) => {
    b.addEventListener("click", () => {
      const dir = Number(b.dataset.ydir);
      yakumanMulti = Math.min(3, Math.max(1, yakumanMulti + dir));
      container.querySelector("#yakuman-value").textContent = yakumanMulti + "倍";
      emit();
    });
  });

  function emit() {
    onChange({ han, fu, yakumanMulti });
  }

  refreshHanLabel();
  emit();
}

function buildRiichiPicker(container, seatIndexes) {
  const selected = new Set();
  container.innerHTML = `<label class="picker-label">リーチ宣言（該当者をタップ）</label><div class="riichi-buttons"></div>`;
  const box = container.querySelector(".riichi-buttons");
  seatIndexes.forEach((idx) => {
    const p = getPlayer(state.seats[idx]);
    const b = el(`<button type="button" class="riichi-btn" data-seat="${idx}">${escapeHtml(p.name)}</button>`);
    b.addEventListener("click", () => {
      if (selected.has(idx)) {
        selected.delete(idx);
        b.classList.remove("riichi-btn-selected");
      } else {
        selected.add(idx);
        b.classList.add("riichi-btn-selected");
      }
    });
    box.appendChild(b);
  });
  return selected;
}

// ---------- モーダル: ロン入力 ----------

function openRonModal() {
  const box = el(`
    <div class="modal-content">
      <h2>ロン</h2>
      <label class="picker-label">和了者</label>
      <div id="winner-buttons" class="seat-select-buttons"></div>
      <label class="picker-label">放銃者</label>
      <div id="loser-buttons" class="seat-select-buttons"></div>

      <div class="mode-toggle" id="mode-toggle">
        <button type="button" class="mode-toggle-btn" data-mode="hanfu">翻符で計算</button>
        <button type="button" class="mode-toggle-btn" data-mode="direct">点数を直接入力</button>
      </div>
      <div id="hanfu-picker"></div>
      <div id="direct-picker" class="direct-input-box" hidden>
        <label class="picker-label">支払い点数（本場は自動で加算されます）</label>
        <input type="number" id="direct-points" class="number-input" step="100" min="0" placeholder="例: 8000">
      </div>

      <div id="riichi-picker"></div>
      <p id="ron-preview" class="preview-text"></p>
      <div class="modal-actions">
        <button id="ron-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="ron-confirm" class="btn btn-primary">確定</button>
      </div>
    </div>
  `);

  let winnerSeat = null;
  let loserSeat = null;
  let mode = "hanfu";
  let handInfo = { han: 3, fu: 30, yakumanMulti: 1 };

  const winnerBtns = box.querySelector("#winner-buttons");
  const loserBtns = box.querySelector("#loser-buttons");
  const hanfuBox = box.querySelector("#hanfu-picker");
  const directBox = box.querySelector("#direct-picker");
  const directInput = box.querySelector("#direct-points");

  function renderChoices() {
    winnerBtns.innerHTML = "";
    loserBtns.innerHTML = "";
    state.seats.forEach((pid, idx) => {
      const p = getPlayer(pid);
      const wb = el(`<button type="button" class="seat-select-btn ${winnerSeat === idx ? "seat-select-btn-selected" : ""}">${escapeHtml(p.name)}</button>`);
      wb.addEventListener("click", () => {
        winnerSeat = idx;
        if (loserSeat === idx) loserSeat = null;
        renderChoices();
      });
      winnerBtns.appendChild(wb);

      if (idx !== winnerSeat) {
        const lb = el(`<button type="button" class="seat-select-btn ${loserSeat === idx ? "seat-select-btn-selected" : ""}">${escapeHtml(p.name)}</button>`);
        lb.addEventListener("click", () => {
          loserSeat = idx;
          renderChoices();
        });
        loserBtns.appendChild(lb);
      }
    });
    updatePreview();
  }

  box.querySelectorAll(".mode-toggle-btn").forEach((b) => {
    if (b.dataset.mode === mode) b.classList.add("mode-toggle-btn-selected");
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      box.querySelectorAll(".mode-toggle-btn").forEach((x) => x.classList.remove("mode-toggle-btn-selected"));
      b.classList.add("mode-toggle-btn-selected");
      hanfuBox.hidden = mode !== "hanfu";
      directBox.hidden = mode !== "direct";
      updatePreview();
    });
  });

  const riichiBox = box.querySelector("#riichi-picker");
  const riichiSelected = buildRiichiPicker(riichiBox, [0, 1, 2, 3]);

  buildHanFuPicker(hanfuBox, (info) => {
    handInfo = info;
    updatePreview();
  });

  directInput.addEventListener("input", updatePreview);

  function getBasePaymentAndLabel() {
    if (mode === "direct") {
      const val = Math.max(0, Number(directInput.value) || 0);
      return { basePayment: val, label: "点数入力" };
    }
    const { base, label } = calcBase(handInfo.han, handInfo.fu, state.settings.kiriageMangan, handInfo.yakumanMulti);
    const basePayment = ronBaseFromHanFu(base, winnerSeat !== null && isDealerSeat(winnerSeat));
    return { basePayment, label: label || `${handInfo.han}翻${handInfo.fu}符` };
  }

  function updatePreview() {
    const preview = box.querySelector("#ron-preview");
    if (winnerSeat === null || loserSeat === null) {
      preview.textContent = "";
      return;
    }
    const { basePayment, label } = getBasePaymentAndLabel();
    const payment = calcRonPayment(basePayment, state.honba);
    preview.textContent = `${label} → ${payment.toLocaleString("ja-JP")}点`;
  }

  renderChoices();

  box.querySelector("#ron-cancel").addEventListener("click", closeModal);
  box.querySelector("#ron-confirm").addEventListener("click", () => {
    if (winnerSeat === null || loserSeat === null) {
      alert("和了者と放銃者を選んでください");
      return;
    }
    const { basePayment, label } = getBasePaymentAndLabel();
    if (mode === "direct" && basePayment <= 0) {
      alert("支払い点数を入力してください");
      return;
    }
    finalizeRon({
      winnerSeat,
      loserSeat,
      basePayment,
      label,
      riichiSeats: Array.from(riichiSelected),
    });
    closeModal();
    renderTable();
  });

  openModal(box);
}

// ---------- モーダル: ツモ入力 ----------

function openTsumoModal() {
  const box = el(`
    <div class="modal-content">
      <h2>ツモ</h2>
      <label class="picker-label">和了者</label>
      <div id="winner-buttons" class="seat-select-buttons"></div>

      <div class="mode-toggle" id="mode-toggle">
        <button type="button" class="mode-toggle-btn" data-mode="hanfu">翻符で計算</button>
        <button type="button" class="mode-toggle-btn" data-mode="direct">点数を直接入力</button>
      </div>
      <div id="hanfu-picker"></div>
      <div id="direct-picker" class="direct-input-box" hidden></div>

      <div id="riichi-picker"></div>
      <p id="tsumo-preview" class="preview-text"></p>
      <div class="modal-actions">
        <button id="tsumo-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="tsumo-confirm" class="btn btn-primary">確定</button>
      </div>
    </div>
  `);

  let winnerSeat = null;
  let mode = "hanfu";
  let handInfo = { han: 3, fu: 30, yakumanMulti: 1 };

  const winnerBtns = box.querySelector("#winner-buttons");
  const hanfuBox = box.querySelector("#hanfu-picker");
  const directBox = box.querySelector("#direct-picker");

  function renderDirectFields() {
    const isDealerWin = winnerSeat !== null && isDealerSeat(winnerSeat);
    if (winnerSeat === null) {
      directBox.innerHTML = `<p class="hint-text">先に和了者を選んでください。</p>`;
      return;
    }
    if (isDealerWin) {
      directBox.innerHTML = `
        <label class="picker-label">子3人がそれぞれ支払う点数（本場は自動で加算されます）</label>
        <input type="number" id="direct-each" class="number-input" step="100" min="0" placeholder="例: 4000">
      `;
    } else {
      directBox.innerHTML = `
        <div class="direct-input-row">
          <label class="picker-label">親が支払う点数（本場は自動で加算されます）</label>
          <input type="number" id="direct-dealer" class="number-input" step="100" min="0" placeholder="例: 2000">
        </div>
        <div class="direct-input-row">
          <label class="picker-label">子2人がそれぞれ支払う点数（本場は自動で加算されます）</label>
          <input type="number" id="direct-other" class="number-input" step="100" min="0" placeholder="例: 1000">
        </div>
      `;
    }
    directBox.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", updatePreview));
  }

  function renderChoices() {
    winnerBtns.innerHTML = "";
    state.seats.forEach((pid, idx) => {
      const p = getPlayer(pid);
      const wb = el(`<button type="button" class="seat-select-btn ${winnerSeat === idx ? "seat-select-btn-selected" : ""}">${escapeHtml(p.name)}</button>`);
      wb.addEventListener("click", () => {
        winnerSeat = idx;
        renderChoices();
        renderDirectFields();
      });
      winnerBtns.appendChild(wb);
    });
    updatePreview();
  }

  box.querySelectorAll(".mode-toggle-btn").forEach((b) => {
    if (b.dataset.mode === mode) b.classList.add("mode-toggle-btn-selected");
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      box.querySelectorAll(".mode-toggle-btn").forEach((x) => x.classList.remove("mode-toggle-btn-selected"));
      b.classList.add("mode-toggle-btn-selected");
      hanfuBox.hidden = mode !== "hanfu";
      directBox.hidden = mode !== "direct";
      updatePreview();
    });
  });

  const riichiBox = box.querySelector("#riichi-picker");
  const riichiSelected = buildRiichiPicker(riichiBox, [0, 1, 2, 3]);

  buildHanFuPicker(hanfuBox, (info) => {
    handInfo = info;
    updatePreview();
  });

  renderDirectFields();

  function getBasePaymentsAndLabel() {
    const isDealerWin = winnerSeat !== null && isDealerSeat(winnerSeat);
    if (mode === "direct") {
      if (isDealerWin) {
        const each = Math.max(0, Number(box.querySelector("#direct-each")?.value) || 0);
        return { basePayments: { type: "dealer", each }, label: "点数入力" };
      }
      const dealerPay = Math.max(0, Number(box.querySelector("#direct-dealer")?.value) || 0);
      const otherPay = Math.max(0, Number(box.querySelector("#direct-other")?.value) || 0);
      return { basePayments: { type: "nondealer", dealerPay, otherPay }, label: "点数入力" };
    }
    const { base, label } = calcBase(handInfo.han, handInfo.fu, state.settings.kiriageMangan, handInfo.yakumanMulti);
    const basePayments = tsumoBaseFromHanFu(base, isDealerWin);
    return { basePayments, label: label || `${handInfo.han}翻${handInfo.fu}符` };
  }

  function updatePreview() {
    const preview = box.querySelector("#tsumo-preview");
    if (winnerSeat === null) {
      preview.textContent = "";
      return;
    }
    const { basePayments, label } = getBasePaymentsAndLabel();
    const result = calcTsumoPayments(basePayments, state.honba);
    const text =
      result.type === "dealer"
        ? `${label} → 子全員 ${result.each.toLocaleString("ja-JP")}点ずつ`
        : `${label} → 親 ${result.dealerPay.toLocaleString("ja-JP")}点 / 子 ${result.otherPay.toLocaleString("ja-JP")}点ずつ`;
    preview.textContent = text;
  }

  renderChoices();

  box.querySelector("#tsumo-cancel").addEventListener("click", closeModal);
  box.querySelector("#tsumo-confirm").addEventListener("click", () => {
    if (winnerSeat === null) {
      alert("和了者を選んでください");
      return;
    }
    const { basePayments, label } = getBasePaymentsAndLabel();
    const hasZero = basePayments.type === "dealer" ? basePayments.each <= 0 : basePayments.dealerPay <= 0 || basePayments.otherPay <= 0;
    if (mode === "direct" && hasZero) {
      alert("支払い点数を入力してください");
      return;
    }
    finalizeTsumo({
      winnerSeat,
      basePayments,
      label,
      riichiSeats: Array.from(riichiSelected),
    });
    closeModal();
    renderTable();
  });

  openModal(box);
}

// ---------- モーダル: 流局入力 ----------

function openDrawModal() {
  const box = el(`
    <div class="modal-content">
      <h2>流局</h2>
      <label class="picker-label">テンパイしていた人（タップで選択）</label>
      <div id="tenpai-buttons" class="seat-select-buttons"></div>
      <div id="riichi-picker"></div>
      <p class="hint-text">全員ノーテン・全員テンパイのときは点の移動はありません。</p>
      <div class="modal-actions">
        <button id="draw-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="draw-confirm" class="btn btn-primary">確定</button>
      </div>
    </div>
  `);

  const tenpaiSelected = new Set();
  const tenpaiBtns = box.querySelector("#tenpai-buttons");
  state.seats.forEach((pid, idx) => {
    const p = getPlayer(pid);
    const b = el(`<button type="button" class="seat-select-btn">${escapeHtml(p.name)}</button>`);
    b.addEventListener("click", () => {
      if (tenpaiSelected.has(idx)) {
        tenpaiSelected.delete(idx);
        b.classList.remove("seat-select-btn-selected");
      } else {
        tenpaiSelected.add(idx);
        b.classList.add("seat-select-btn-selected");
      }
    });
    tenpaiBtns.appendChild(b);
  });

  const riichiSelected = buildRiichiPicker(box.querySelector("#riichi-picker"), [0, 1, 2, 3]);

  box.querySelector("#draw-cancel").addEventListener("click", closeModal);
  box.querySelector("#draw-confirm").addEventListener("click", () => {
    finalizeDraw({ tenpaiSeats: Array.from(tenpaiSelected), riichiSeats: Array.from(riichiSelected) });
    closeModal();
    renderTable();
  });

  openModal(box);
}

// ---------- モーダル: 点数調整 ----------

function openAdjustModal() {
  const box = el(`
    <div class="modal-content">
      <h2>点数調整</h2>
      <label class="picker-label">対象者</label>
      <div id="target-buttons" class="seat-select-buttons"></div>
      <label class="picker-label">増減する点数（マイナスも可）</label>
      <input type="number" id="adjust-amount" class="number-input" step="100" value="0">
      <label class="picker-label">メモ（任意）</label>
      <input type="text" id="adjust-note" class="text-input" maxlength="20">
      <div class="modal-actions">
        <button id="adjust-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="adjust-confirm" class="btn btn-primary">確定</button>
      </div>
    </div>
  `);

  let targetId = null;
  const targetBtns = box.querySelector("#target-buttons");
  state.players.forEach((p) => {
    const b = el(`<button type="button" class="seat-select-btn">${escapeHtml(p.name)}</button>`);
    b.addEventListener("click", () => {
      targetId = p.id;
      targetBtns.querySelectorAll(".seat-select-btn").forEach((x) => x.classList.remove("seat-select-btn-selected"));
      b.classList.add("seat-select-btn-selected");
    });
    targetBtns.appendChild(b);
  });

  box.querySelector("#adjust-cancel").addEventListener("click", closeModal);
  box.querySelector("#adjust-confirm").addEventListener("click", () => {
    if (!targetId) {
      alert("対象者を選んでください");
      return;
    }
    const amount = Number(box.querySelector("#adjust-amount").value) || 0;
    const note = box.querySelector("#adjust-note").value.trim();
    applyManualAdjust(targetId, amount, note);
    closeModal();
    renderTable();
  });

  openModal(box);
}

// ---------- モーダル: メンバー追加 ----------

function openAddPlayerModal() {
  if (state.players.length >= MAX_PLAYERS) {
    alert(`メンバーは最大${MAX_PLAYERS}人までです`);
    return;
  }
  const box = el(`
    <div class="modal-content">
      <h2>メンバー追加</h2>
      <p class="hint-text">追加したメンバーは待機列に加わり、持ち点は開始時の設定（${state.settings.startPoints.toLocaleString("ja-JP")}点）から始まります。</p>
      <input type="text" id="new-player-input" class="text-input" maxlength="8" placeholder="なまえ（8文字まで）">
      <div class="modal-actions">
        <button id="addp-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="addp-confirm" class="btn btn-primary">追加</button>
      </div>
    </div>
  `);

  box.querySelector("#addp-cancel").addEventListener("click", closeModal);
  box.querySelector("#addp-confirm").addEventListener("click", () => {
    const name = box.querySelector("#new-player-input").value.trim();
    if (!name) return;
    const p = { id: uid(), name, score: state.settings.startPoints };
    state.players.push(p);
    state.waitingQueue.push(p.id);
    closeModal();
    renderTable();
  });

  openModal(box);
}

// ---------- 記録・順位表画面 ----------

function renderHistoryScreen() {
  const leaderboard = document.getElementById("leaderboard");
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  leaderboard.innerHTML = "";
  sorted.forEach((p, i) => {
    const diff = p.score - state.settings.startPoints;
    const row = el(`
      <div class="leaderboard-row">
        <span class="lb-rank">${i + 1}位</span>
        <span class="lb-name">${escapeHtml(p.name)}${state.waitingQueue.includes(p.id) ? "（待機中）" : ""}</span>
        <span class="lb-score">${p.score.toLocaleString("ja-JP")}</span>
        <span class="lb-diff ${diff >= 0 ? "positive" : "negative"}">${formatPoints(diff)}</span>
      </div>
    `);
    leaderboard.appendChild(row);
  });

  const list = document.getElementById("history-list");
  list.innerHTML = "";
  if (state.history.length === 0) {
    list.appendChild(el(`<p class="hint-text">まだ記録がありません。</p>`));
  } else {
    [...state.history]
      .reverse()
      .forEach((h) => {
        const row = el(`
          <div class="history-row">
            <div class="history-summary">${escapeHtml(h.summary)}</div>
            <div class="history-time">${new Date(h.time).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        `);
        list.appendChild(row);
      });
  }
}

// ---------- 過去の記録・通算成績画面 ----------

// スプレッドシートからのコピペ（タブ区切り）を読み込む。
// 1行目: 名前を並べたヘッダー行（先頭は日付列なので空でよい）
// 2行目以降: 日付, その日の各プレイヤーの収支（空欄=その回は不参加）
// 日付が空の行は「直前の日付と同じ日のもう1局」として扱う。
function parseSpreadsheetImport(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    return { entries: [], warnings: ["データが見つかりませんでした。1行目に名前、2行目以降に日付と収支を貼り付けてください。"] };
  }

  const names = lines[0].split("\t").map((s) => s.trim()).filter((s) => s !== "");
  if (names.length === 0) {
    return { entries: [], warnings: ["1行目からプレイヤー名が読み取れませんでした。"] };
  }

  const warnings = [];
  const entries = [];
  let lastMonth = null;
  let year = new Date().getFullYear() - 1;
  let lastDateKey = null;
  let sameDaySeq = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const dateCell = (cells[0] || "").trim();
    const values = cells.slice(1);

    const results = [];
    let sum = 0;
    let hasValue = false;
    names.forEach((name, idx) => {
      const raw = (values[idx] || "").trim();
      if (raw === "") return;
      const n = Number(raw.replace(/,/g, ""));
      if (Number.isNaN(n)) {
        warnings.push(`${i + 1}行目: 「${raw}」を数値として読み取れませんでした（${name}）`);
        return;
      }
      hasValue = true;
      sum += n;
      results.push({ name, diff: n, score: DEFAULT_START_POINTS + n });
    });

    if (!hasValue) continue;

    if (sum !== 0) {
      warnings.push(`${i + 1}行目（${dateCell || "同日"}）: 収支の合計が0になりません（合計${sum}）`);
    }

    let dateKey = dateCell;
    const m = dateCell.match(/^(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (lastMonth !== null && month < lastMonth - 6) year += 1;
      lastMonth = month;
      dateKey = `${month}/${day}`;
      if (dateKey !== lastDateKey) {
        sameDaySeq = 0;
        lastDateKey = dateKey;
      } else {
        sameDaySeq += 1;
      }
      entries.push({
        id: uid(),
        endedAt: new Date(year, month - 1, day, 12, sameDaySeq).getTime(),
        startPoints: DEFAULT_START_POINTS,
        results,
        hands: [],
      });
    } else if (dateCell === "" && lastDateKey !== null) {
      // 日付が空欄 = 直前の日付と同じ日のもう1局
      sameDaySeq += 1;
      const [month, day] = lastDateKey.split("/").map(Number);
      entries.push({
        id: uid(),
        endedAt: new Date(year, month - 1, day, 12, sameDaySeq).getTime(),
        startPoints: DEFAULT_START_POINTS,
        results,
        hands: [],
      });
    } else {
      warnings.push(`${i + 1}行目: 日付が読み取れず、この行はスキップしました`);
    }
  }

  return { entries, warnings };
}

function openImportModal() {
  const box = el(`
    <div class="modal-content">
      <h2>スプレッドシートから読み込む</h2>
      <p class="hint-text">
        1行目にプレイヤー名、2行目以降に「日付・各プレイヤーの収支」をタブ区切りで貼り付けてください。
        空欄はその回は不参加という意味になります。日付が空欄の行は、直前の日付と同じ日のもう1局として扱われます。
      </p>
      <textarea id="import-textarea" class="text-input import-textarea" placeholder="ひろと&#9;ともみ&#9;ひな&#9;みう&#9;たつき&#9;けいた&#10;9/21&#9;-4000&#9;&#9;&#9;12000&#9;-4000&#9;-4000"></textarea>
      <div id="import-result" class="hint-text"></div>
      <div class="modal-actions">
        <button id="import-cancel" class="btn btn-secondary">キャンセル</button>
        <button id="import-confirm" class="btn btn-primary">読み込む</button>
      </div>
    </div>
  `);

  box.querySelector("#import-cancel").addEventListener("click", closeModal);
  box.querySelector("#import-confirm").addEventListener("click", () => {
    const text = box.querySelector("#import-textarea").value;
    const { entries, warnings } = parseSpreadsheetImport(text);
    const resultBox = box.querySelector("#import-result");

    if (entries.length === 0) {
      resultBox.textContent = warnings.length ? warnings.join(" / ") : "読み込める内容がありませんでした。";
      return;
    }

    const archive = loadArchive();
    const merged = archive.concat(entries).sort((a, b) => b.endedAt - a.endedAt);
    saveArchive(merged);

    let msg = `${entries.length}件のセッションを読み込みました。`;
    if (warnings.length > 0) {
      msg += ` （${warnings.length}件の注意点があります: ${warnings.slice(0, 3).join(" / ")}${warnings.length > 3 ? " ..." : ""}）`;
    }
    resultBox.textContent = msg;
    renderArchiveScreen();
  });

  openModal(box);
}

function computeCumulativeStats(archive) {
  const statsByName = new Map();
  let maxRank = 0;

  archive.forEach((session) => {
    const ranked = [...session.results].sort((a, b) => b.score - a.score);

    // 同点のときは同じ順位として数える。そうしないと、並び順という
    // 中身に関係ないものだけで順位が決まってしまう。
    const ranks = ranked.map((r, i) => (i > 0 && ranked[i - 1].score === r.score ? null : i + 1));
    ranks.forEach((v, i) => {
      if (v === null) ranks[i] = ranks[i - 1];
    });

    ranked.forEach((r, i) => {
      const rank = ranks[i];
      if (rank > maxRank) maxRank = rank;
      if (!statsByName.has(r.name)) {
        statsByName.set(r.name, { name: r.name, sessions: 0, totalDiff: 0, rankCounts: {} });
      }
      const s = statsByName.get(r.name);
      s.sessions += 1;
      s.totalDiff += r.diff;
      s.rankCounts[rank] = (s.rankCounts[rank] || 0) + 1;
    });
  });

  const list = [...statsByName.values()].sort((a, b) => b.totalDiff - a.totalDiff);
  return { stats: list, maxRank };
}

function renderArchiveScreen() {
  const archive = loadArchive();

  const statsBox = document.getElementById("stats-table");
  statsBox.innerHTML = "";
  const { stats, maxRank } = computeCumulativeStats(archive);
  if (stats.length === 0) {
    statsBox.appendChild(el(`<p class="hint-text">まだ終了した対局がありません。</p>`));
  } else {
    stats.forEach((s, i) => {
      const avg = Math.round(s.totalDiff / s.sessions);
      const rankChips = [];
      for (let r = 1; r <= maxRank; r++) {
        const n = s.rankCounts[r] || 0;
        rankChips.push(`<span class="rank-chip ${n === 0 ? "rank-chip-zero" : ""}"><span class="rank-chip-label">${r}位</span><b>${n}</b></span>`);
      }
      const row = el(`
        <div class="stat-row">
          <div class="stat-head">
            <span class="lb-rank">${i + 1}位</span>
            <span class="lb-name">${escapeHtml(s.name)}</span>
            <span class="lb-diff ${s.totalDiff >= 0 ? "positive" : "negative"}">${formatPoints(s.totalDiff)}</span>
          </div>
          <div class="stat-sub">${s.sessions}対局・平均${formatPoints(avg)}</div>
          <div class="rank-chips" style="grid-template-columns: repeat(${maxRank}, 1fr);">${rankChips.join("")}</div>
        </div>
      `);
      statsBox.appendChild(row);
    });
  }

  document.getElementById("archive-clear-btn").hidden = archive.length === 0;

  const listBox = document.getElementById("archive-list");
  listBox.innerHTML = "";
  if (archive.length === 0) {
    listBox.appendChild(el(`<p class="hint-text">過去の対局はまだありません。</p>`));
    return;
  }

  archive.forEach((session) => {
    const ranked = [...session.results].sort((a, b) => b.score - a.score);
    const dateText = new Date(session.endedAt).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const isOpen = expandedArchiveIds.has(session.id);

    const card = el(`
      <div class="archive-card">
        <button type="button" class="archive-card-header">
          <span class="archive-date">${dateText}</span>
          <span class="archive-summary">${ranked
            .map((r, i) => `${i + 1}位 ${escapeHtml(r.name)}(${formatPoints(r.diff)})`)
            .join(" / ")}</span>
        </button>
        <div class="archive-detail" ${isOpen ? "" : "hidden"}></div>
      </div>
    `);

    const detailBox = card.querySelector(".archive-detail");
    if (session.hands.length === 0) {
      detailBox.appendChild(el(`<p class="hint-text">記録された局はありません。</p>`));
    } else {
      session.hands.forEach((h) => {
        detailBox.appendChild(
          el(`
            <div class="history-row">
              <div class="history-summary">${escapeHtml(h.summary)}</div>
              <div class="history-time">${new Date(h.time).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          `)
        );
      });
    }

    card.querySelector(".archive-card-header").addEventListener("click", () => {
      if (expandedArchiveIds.has(session.id)) {
        expandedArchiveIds.delete(session.id);
      } else {
        expandedArchiveIds.add(session.id);
      }
      renderArchiveScreen();
    });

    listBox.appendChild(card);
  });
}

// ---------- 初期化・イベント登録 ----------

function bindTableEvents() {
  document.getElementById("btn-ron").addEventListener("click", openRonModal);
  document.getElementById("btn-tsumo").addEventListener("click", openTsumoModal);
  document.getElementById("btn-draw").addEventListener("click", openDrawModal);
  document.getElementById("btn-adjust").addEventListener("click", openAdjustModal);
  document.getElementById("btn-add-player").addEventListener("click", openAddPlayerModal);
  document.getElementById("btn-undo").addEventListener("click", () => {
    undoLast();
    renderTable();
  });
  document.getElementById("btn-history").addEventListener("click", () => {
    renderHistoryScreen();
    showScreen("screen-history");
  });
  document.getElementById("history-back-btn").addEventListener("click", () => {
    showScreen("screen-table");
    renderTable();
  });
  document.getElementById("end-session-btn").addEventListener("click", () => {
    if (confirm("対局を終了します。ここまでの記録は「過去の記録」に保存されます。よろしいですか？")) {
      archiveCurrentSession();
      clearState();
      // 次の対局も同じ顔ぶれで始めることが多いので、メンバーは残しておく
      setupPlayers = loadMemberNames();
      renderSetupPlayerList();
      showScreen("screen-setup");
      document.getElementById("setup-resume").hidden = true;
    }
  });
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

  document.getElementById("setup-archive-btn").addEventListener("click", () => {
    archiveBackTarget = "screen-setup";
    renderArchiveScreen();
    showScreen("screen-archive");
  });
  document.getElementById("history-archive-btn").addEventListener("click", () => {
    archiveBackTarget = "screen-history";
    renderArchiveScreen();
    showScreen("screen-archive");
  });
  document.getElementById("archive-back-btn").addEventListener("click", () => {
    if (archiveBackTarget === "screen-history") {
      renderHistoryScreen();
      showScreen("screen-history");
    } else {
      showScreen("screen-setup");
    }
  });
  document.getElementById("archive-clear-btn").addEventListener("click", () => {
    if (confirm("過去の記録・通算成績をすべて削除します。よろしいですか？")) {
      localStorage.removeItem(ARCHIVE_KEY);
      renderArchiveScreen();
    }
  });
  document.getElementById("archive-import-btn").addEventListener("click", openImportModal);
}

function init() {
  initSetupScreen();
  bindTableEvents();

  const saved = loadState();
  if (saved && saved.started) {
    // セットアップ画面のまま「前回の続きから」ボタンを押すのを待つ。
    // ただしアプリを閉じずに使い続けているケースを想定し、即座に卓へ入れておく。
    state = saved;
    showScreen("screen-table");
    renderTable();
  } else {
    showScreen("screen-setup");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
