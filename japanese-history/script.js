"use strict";

// ===== 定数 =====
const STORE_KEY = "jphistory-v2";
const OLD_STORE_KEY = "jphistory-v1"; // 使用者を分ける前の記録
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
// store … 端末に保存するもの全体。players は「なまえ」ごとの設定と記録。
let store = {
  group: null,   // あいことば（記録を分け合うときのキー）
  current: null, // いま遊んでいる人のなまえ
  order: [],     // この端末に登録されたなまえ（新しい順）
  players: {}
};

let state = null; // store.players[store.current] への参照
let session = null;
let audioCtx = null;
let confettiHandle = null;
let cloud = null;        // { baseUrl } — クラウドが使えないときは null のまま
let cloudRecords = {};   // クラウドから読んだ記録（なまえ => 記録）
let playerEditMode = false;
let pushTimer = null;
let legacyPlayer = null; // 使用者を分ける前の記録。最初の1人に引きつぐ

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
function blankStats() {
  return { best: 0, current: 0, plays: 0, perfect: 0 };
}

// 時代べつの成績。a は出した数、c は正解した数。
// eraOrder は「5つの時代のならべかえ」（1つの時代に決められない問題）の分。
function blankDetail() {
  return { eraOrder: { a: 0, c: 0 }, eras: {} };
}

function normalizeDetail(raw) {
  const d = blankDetail();
  if (!raw || typeof raw !== "object") return d;
  d.eraOrder = normalizeCount(raw.eraOrder);
  const eras = raw.eras && typeof raw.eras === "object" ? raw.eras : {};
  Object.keys(eras).forEach((id) => {
    // 出題データから消えた時代の記録は読みこまない
    if (ALL_ERA_IDS.includes(id)) d.eras[id] = normalizeCount(eras[id]);
  });
  return d;
}

function blankPlayer() {
  return {
    level: "jhs",
    eras: ALL_ERA_IDS.slice(),
    stats: { es: blankStats(), jhs: blankStats() },
    detail: { es: blankDetail(), jhs: blankDetail() },
    updatedAt: 0
  };
}

function normalizeCount(raw) {
  const out = { a: 0, c: 0 };
  if (!raw || typeof raw !== "object") return out;
  ["a", "c"].forEach((f) => {
    if (typeof raw[f] === "number" && raw[f] >= 0) out[f] = Math.floor(raw[f]);
  });
  // 正解数が出題数をこえることはない
  if (out.c > out.a) out.c = out.a;
  return out;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (err) {
    return null;
  }
}

// 保存されていた内容は、そのまま信じずに整えてから取りこむ
function normalizePlayer(raw) {
  const p = blankPlayer();
  if (!raw || typeof raw !== "object") return p;
  if (raw.level === "es" || raw.level === "jhs") p.level = raw.level;
  if (Array.isArray(raw.eras)) {
    const kept = raw.eras.filter((id) => ALL_ERA_IDS.includes(id));
    if (kept.length >= ORDER_COUNT) p.eras = kept;
  }
  ["es", "jhs"].forEach((key) => {
    const s = raw.stats && raw.stats[key];
    if (!s) return;
    ["best", "current", "plays", "perfect"].forEach((f) => {
      if (typeof s[f] === "number" && s[f] >= 0) p.stats[key][f] = Math.floor(s[f]);
    });
    // 記録より今の連続が大きい状態はありえないので、そろえておく
    if (p.stats[key].current > p.stats[key].best) p.stats[key].best = p.stats[key].current;
  });
  ["es", "jhs"].forEach((key) => {
    p.detail[key] = normalizeDetail(raw.detail && raw.detail[key]);
  });
  if (typeof raw.updatedAt === "number" && raw.updatedAt > 0) p.updatedAt = raw.updatedAt;
  return p;
}

function load() {
  const saved = readJson(STORE_KEY);
  if (saved && typeof saved === "object") {
    if (typeof saved.group === "string") store.group = saved.group;
    if (typeof saved.current === "string") store.current = saved.current;
    if (Array.isArray(saved.order)) store.order = saved.order.filter((n) => typeof n === "string" && n);
    const players = saved.players && typeof saved.players === "object" ? saved.players : {};
    Object.keys(players).forEach((name) => {
      store.players[name] = normalizePlayer(players[name]);
    });
  }

  // 名簿と記録のどちらかにしかないなまえを、両方にそろえる
  Object.keys(store.players).forEach((name) => {
    if (!store.order.includes(name)) store.order.push(name);
  });
  store.order.forEach((name) => {
    if (!store.players[name]) store.players[name] = blankPlayer();
  });
  if (store.current && !store.players[store.current]) store.current = null;

  // 使用者を分ける前の記録は、最初に登録した人に引きつぐ
  const old = readJson(OLD_STORE_KEY);
  if (old && typeof old === "object" && store.order.length === 0) legacyPlayer = normalizePlayer(old);

  if (store.current) state = store.players[store.current];
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (err) {
    // 保存できなくても遊べるようにする（シークレットモードなど）
  }
}

// 記録が変わったときに呼ぶ。更新した時刻を入れてからクラウドへ送る
function touchPlayer() {
  if (!state) return;
  state.updatedAt = Date.now();
  save();
  schedulePush();
}

const stats = () => state.stats[state.level];
const levelInfo = () => LEVELS.find((l) => l.id === state.level);

// ===== なまえ（使用者）=====
function usePlayer(name) {
  if (!store.players[name]) {
    // いちばん最初の1人には、使用者を分ける前の記録を引きつがせる
    store.players[name] = legacyPlayer || blankPlayer();
    legacyPlayer = null;
    try {
      localStorage.removeItem(OLD_STORE_KEY);
    } catch (err) {
      // 消せなくても実害はない
    }
  }
  store.current = name;
  store.order = [name].concat(store.order.filter((n) => n !== name)).slice(0, 20);
  state = store.players[name];
  save();
  pushPlayerRecord(name);
}

function renamePlayer(oldName, newName) {
  if (!store.players[oldName] || store.players[newName]) return false;
  store.players[newName] = store.players[oldName];
  delete store.players[oldName];
  store.players[newName].updatedAt = Date.now();
  store.order = store.order.map((n) => (n === oldName ? newName : n));
  if (store.current === oldName) {
    store.current = newName;
    state = store.players[newName];
  }
  save();
  deletePlayerRecord(oldName);
  pushPlayerRecord(newName);
  return true;
}

function deletePlayer(name) {
  delete store.players[name];
  store.order = store.order.filter((n) => n !== name);
  if (store.current === name) {
    store.current = null;
    state = null;
  }
  save();
  deletePlayerRecord(name);
}

// ===== クラウドどうき（Realtime Database の REST API）=====
// さんすうアプリと同じ Firebase・同じあいことばを使い、
// groups/<あいことば>/history の下にこのアプリの記録だけを置く。
// さんすうアプリが読み書きするのは同じグループの players と scores なので、
// たがいの記録がまざることはない。databaseURL が空のときや通信に失敗した
// ときは、端末内（localStorage）だけで動く。
function initCloud() {
  const config = window.FIREBASE_CONFIG;
  if (!config || !config.databaseURL) return false;
  cloud = { baseUrl: config.databaseURL.replace(/\/+$/, "") };
  return true;
}

// あいことばはそのままパスに使うので、使えない文字や大文字小文字のゆれを吸収する
function normalizeGroupCode(raw) {
  return raw.trim().toLowerCase().replace(/[^0-9a-z぀-ヿ一-鿿]/g, "").slice(0, 20);
}

// なまえには「.」など、データベースのキーに使えない文字が入ることがある。
// UTF-8 を16進にして、どの端末でも同じキーになるようにする。
function nameKey(name) {
  return Array.from(new TextEncoder().encode(name))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function recordsUrl(suffix) {
  return `${cloud.baseUrl}/groups/${encodeURIComponent(store.group)}/history${suffix}.json`;
}

async function fetchRecordsFromCloud() {
  if (!cloud || !store.group) return {};
  try {
    const res = await fetch(recordsUrl(""));
    if (!res.ok) return {};
    const data = await res.json();
    if (!data || typeof data !== "object") return {};
    const out = {};
    Object.keys(data).forEach((key) => {
      const rec = data[key];
      if (rec && typeof rec === "object" && typeof rec.name === "string" && rec.name) out[rec.name] = rec;
    });
    return out;
  } catch (err) {
    return {}; // オフラインなど
  }
}

async function pushPlayerRecord(name) {
  if (!cloud || !store.group) return;
  const p = store.players[name];
  if (!p) return;
  const rec = {
    name,
    es: p.stats.es,
    jhs: p.stats.jhs,
    detail: p.detail,
    updatedAt: p.updatedAt || Date.now()
  };
  try {
    await fetch(recordsUrl(`/${nameKey(name)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec)
    });
    cloudRecords[name] = rec;
  } catch (err) {
    // 送れなくても端末内には残る
  }
}

async function deletePlayerRecord(name) {
  if (!cloud || !store.group) return;
  delete cloudRecords[name];
  try {
    await fetch(recordsUrl(`/${nameKey(name)}`), { method: "DELETE" });
  } catch (err) {
    // 同上
  }
}

// 続けて何問も答えるあいだ送りっぱなしにならないよう、少し待ってから送る
function schedulePush() {
  if (!cloud || !store.group || !store.current) return;
  const name = store.current;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushPlayerRecord(name), 1200);
}

// 記録は「大きいほう」を残す。いまの連続正解だけは、あとから書かれたほうを採る。
function mergeStats(local, remote) {
  const out = blankStats();
  ["best", "plays", "perfect"].forEach((f) => {
    out[f] = Math.max(local[f] || 0, (remote && remote[f]) || 0);
  });
  out.current = local.current || 0;
  return out;
}

// 時代べつの成績は、たくさん解いたほうの端末の数をそのまま採る。
// 足し合わせると、同じ記録を2回数えてしまうことがあるため。
function pickBusier(local, remote) {
  const l = normalizeCount(local);
  const r = normalizeCount(remote);
  if (r.a > l.a || (r.a === l.a && r.c > l.c)) return r;
  return l;
}

function mergeDetail(local, remote) {
  const r = normalizeDetail(remote);
  local.eraOrder = pickBusier(local.eraOrder, r.eraOrder);
  Object.keys(r.eras).forEach((id) => {
    local.eras[id] = pickBusier(local.eras[id], r.eras[id]);
  });
}

function askedTotal(detail) {
  return Object.keys(detail.eras).reduce((n, id) => n + detail.eras[id].a, detail.eraOrder.a);
}

function mergeCloudIntoLocal(records) {
  Object.keys(records).forEach((name) => {
    const rec = records[name];
    if (!store.players[name]) {
      store.players[name] = blankPlayer();
      store.order.push(name);
    }
    const local = store.players[name];
    const remoteNewer = (rec.updatedAt || 0) > (local.updatedAt || 0);
    ["es", "jhs"].forEach((key) => {
      const merged = mergeStats(local.stats[key], rec[key]);
      if (remoteNewer) merged.current = (rec[key] && rec[key].current) || 0;
      if (merged.current > merged.best) merged.best = merged.current;
      local.stats[key] = merged;
    });
    ["es", "jhs"].forEach((key) => {
      mergeDetail(local.detail[key], rec.detail && rec.detail[key]);
    });
    if (remoteNewer) local.updatedAt = rec.updatedAt;
  });
  if (store.current) state = store.players[store.current];
  save();
}

function needsPush(name) {
  const rec = cloudRecords[name];
  if (!rec) return true;
  const p = store.players[name];
  if ((p.updatedAt || 0) > (rec.updatedAt || 0)) return true;
  if (
    ["es", "jhs"].some((key) => {
      const remote = rec.detail && rec.detail[key];
      const asked = askedTotal(normalizeDetail(remote));
      return askedTotal(p.detail[key]) > asked;
    })
  ) {
    return true;
  }
  return ["es", "jhs"].some((key) =>
    ["best", "plays", "perfect"].some((f) => (p.stats[key][f] || 0) > ((rec[key] && rec[key][f]) || 0))
  );
}

// クラウドと端末の記録を合わせる
async function syncWithCloud() {
  if (!cloud || !store.group) return;
  cloudRecords = await fetchRecordsFromCloud();
  mergeCloudIntoLocal(cloudRecords);
  await Promise.all(store.order.filter(needsPush).map(pushPlayerRecord));
}

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
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.id !== id;
  });
  window.scrollTo(0, 0);
}

// ===== なまえをえらぶ画面 =====
// 端末に登録したなまえに、同じあいことばでクラウドにある なまえも足して出す。
// これで新しい端末でも、あいことばを入れれば家族のなまえがそのまま選べる。
function knownPlayerNames() {
  const names = store.order.slice();
  Object.keys(cloudRecords).forEach((name) => {
    if (!names.includes(name)) names.push(name);
  });
  return names;
}

function bestOf(name) {
  const p = store.players[name];
  if (!p) return 0;
  return Math.max(p.stats.es.best, p.stats.jhs.best);
}

function renderPlayerList() {
  const container = $("player-list");
  container.innerHTML = "";
  const names = knownPlayerNames();
  if (names.length === 0) {
    playerEditMode = false;
    return;
  }

  const head = document.createElement("div");
  head.className = "player-list-head";
  const label = document.createElement("span");
  label.className = "player-list-label";
  label.textContent = playerEditMode ? "なまえを かえる / けす" : "とうろくずみのなまえ";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn-link inline";
  toggle.textContent = playerEditMode ? "おわり" : "へんしゅう";
  toggle.addEventListener("click", () => {
    playerEditMode = !playerEditMode;
    renderPlayerList();
  });
  head.append(label, toggle);
  container.appendChild(head);

  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "player-row";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-list-item";
    btn.dataset.name = name;
    btn.innerHTML = `<span>\u{1F464} ${name}</span><span class="player-best">最高 ${bestOf(name)}問</span>`;
    // へんしゅう中はえらべないようにして、あやまって始めてしまうのを防ぐ
    btn.disabled = playerEditMode;
    row.appendChild(btn);

    if (playerEditMode) {
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "player-edit-btn";
      rename.textContent = "\u270F\uFE0F";
      rename.title = "なまえをかえる";
      rename.addEventListener("click", () => handleRenamePlayer(name));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "player-edit-btn player-delete-btn";
      remove.textContent = "\u{1F5D1}\uFE0F";
      remove.title = "けす";
      remove.addEventListener("click", () => handleDeletePlayer(name));

      row.append(rename, remove);
    }

    container.appendChild(row);
  });
}

function handleRenamePlayer(name) {
  const input = window.prompt("あたらしい なまえを いれてね", name);
  if (input === null) return;
  const next = input.trim().slice(0, 10);
  if (!next || next === name) return;
  if (store.players[next]) {
    window.alert(`「${next}」は もう とうろくされています。`);
    return;
  }
  if (!store.players[name]) store.players[name] = blankPlayer();
  renamePlayer(name, next);
  renderPlayerList();
}

function handleDeletePlayer(name) {
  const ok = window.confirm(
    `「${name}」を けしますか？\n` +
      `さいこう連続正解記録 ${bestOf(name)}問も いっしょに きえます。`
  );
  if (!ok) return;
  deletePlayer(name);
  renderPlayerList();
}

function enterPlayerScreen() {
  stopCelebration();
  playerEditMode = false;
  renderPlayerList();
  showScreen("screen-player");
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

function renderPlayerBar() {
  $("player-display").textContent = store.current ? `\u{1F464} ${store.current} さん` : "";
  // クラウドを使っていないときは、あいことばの欄自体を出さない
  $("group-bar").hidden = !cloud || !store.group;
  $("group-display").textContent = store.group ? `あいことば: ${store.group}` : "";
}

function renderHome() {
  renderPlayerBar();
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

// ===== がくしゅうの記録画面 =====
function percent(count, asked) {
  return asked > 0 ? Math.round((count / asked) * 100) : 0;
}

function barClass(p) {
  return p >= 80 ? "good" : p >= 50 ? "mid" : "weak";
}

function statTile(label, value, sub, wide) {
  return (
    `<div class="stat-tile${wide ? " wide" : ""}">` +
    `<span class="stat-label">${label}</span>` +
    `<span class="stat-value">${value}</span>` +
    `<span class="stat-sub">${sub}</span></div>`
  );
}

function renderStatsLevelChips() {
  const box = $("stats-level-chips");
  box.innerHTML = "";
  LEVELS.forEach((lv) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.level === lv.id ? " selected" : "");
    btn.textContent = `${lv.label}の記録`;
    btn.addEventListener("click", () => {
      // ここで切りかえた むずかしさは、そのまま次の出題にも使う
      state.level = lv.id;
      save();
      renderStats();
    });
    box.appendChild(btn);
  });
}

function renderStats() {
  const d = state.detail[state.level];
  const s = stats();

  $("stats-player").textContent = store.current ? `\u{1F464} ${store.current} さん` : "";
  renderStatsLevelChips();

  const asked = askedTotal(d);
  const correct = Object.keys(d.eras).reduce((n, id) => n + d.eras[id].c, d.eraOrder.c);
  const rate = percent(correct, asked);

  $("stats-summary").innerHTML =
    statTile("ぜんたいの正答率", `${rate}%`, `${correct} / ${asked}問`) +
    statTile("最大連続正解記録", `${s.best}問`, `いま ${s.current}問れんぞく`) +
    statTile("あそんだ回数", `${s.plays}回`, "1回 = 7問") +
    statTile("ぜんもん正解", `${s.perfect}回`, "7問すべて正解") +
    statTile(
      "5つの時代のならべかえ",
      `${percent(d.eraOrder.c, d.eraOrder.a)}%`,
      d.eraOrder.a > 0 ? `${d.eraOrder.c} / ${d.eraOrder.a}問` : "まだ ちょうせんしていません",
      true
    );

  // 時代べつ。1セット分（6問）以上といた時代だけ、とくい・にがてを言う
  const tried = ERAS.filter((era) => (d.eras[era.id] || {}).a > 0);
  const enough = tried.filter((era) => d.eras[era.id].a >= 6);
  const rated = enough
    .map((era) => ({ era, p: percent(d.eras[era.id].c, d.eras[era.id].a) }))
    .sort((x, y) => y.p - x.p);

  if (rated.length >= 2 && rated[0].p !== rated[rated.length - 1].p) {
    const top = rated[0];
    const low = rated[rated.length - 1];
    $("stats-verdict").innerHTML =
      `とくいな時代は <strong>${top.era.name}（${top.p}%）</strong>。` +
      `いま にがてなのは <strong>${low.era.name}（${low.p}%）</strong>。` +
      `ホームの「出題する時代」で ${low.era.name} をふくむ ちかい時代をえらぶと、` +
      `にがてなところを 重点的に れんしゅうできます。`;
  } else if (tried.length === 0) {
    $("stats-verdict").textContent = "まだ記録がありません。1回あそぶと、ここに時代べつの正答率が出ます。";
  } else {
    $("stats-verdict").textContent =
      "もう少しあそぶと、とくい・にがてな時代がはっきりします（1つの時代を6問以上といた時点から）。";
  }

  $("era-stats").innerHTML = ERAS.map((era) => {
    // 数が 0 のままの記録は「まだ」として扱う
    const box = d.eras[era.id] && d.eras[era.id].a > 0 ? d.eras[era.id] : null;
    const p = box ? percent(box.c, box.a) : 0;
    const num = box ? `${box.c} / ${box.a}問　${p}%` : "まだ";
    return (
      `<div class="era-stat${box ? "" : " untried"}">` +
      `<div class="era-stat-head"><span class="era-stat-name">${era.name}</span>` +
      `<span class="era-stat-num">${num}</span></div>` +
      `<div class="era-stat-bar"><span class="${barClass(p)}" style="width:${box ? p : 0}%"></span></div>` +
      `</div>`
    );
  }).join("");
}

function enterStats() {
  if (!state) return;
  stopCelebration();
  renderStats();
  showScreen("screen-stats");
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
    subject: "era",
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
    subject: "event",
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

  // 時代べつの成績。時代のならべかえは1つの時代に決められないので分けて数える
  const detail = state.detail[state.level];
  if (q.kind === "order" && q.subject === "era") {
    detail.eraOrder.a += 1;
    if (correct) detail.eraOrder.c += 1;
  } else {
    const box = detail.eras[session.era.id] || { a: 0, c: 0 };
    box.a += 1;
    if (correct) box.c += 1;
    detail.eras[session.era.id] = box;
  }

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
  touchPlayer();

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
  touchPlayer();

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

  showScreen("screen-result");
  if (perfect || session.newRecord) celebrate();
}

// ===== 起動 =====
function startQuiz() {
  if (!state || state.eras.length < ORDER_COUNT) return;
  getAudioContext(); // 最初のタップで音を使えるようにする
  stopCelebration();
  buildSession();
  showScreen("screen-quiz");
  renderQuestion();
}

function goHome() {
  stopCelebration();
  session = null;
  if (!store.current) {
    enterPlayerScreen();
    return;
  }
  renderHome();
  showScreen("screen-home");
}

// あいことばが決まったら、クラウドの記録を読みこんでから次の画面へ進む
async function syncAndRoute() {
  await syncWithCloud();
  if (store.current) goHome();
  else enterPlayerScreen();
}

function init() {
  load();

  // クラウドが使えるかどうかに関わらず、まず今ある情報で画面を出す
  const cloudReady = initCloud();
  if (cloudReady && !store.group) showScreen("screen-group");
  else if (store.current) goHome();
  else enterPlayerScreen();

  // クラウドが使えるなら、記録を取りこんでから画面を出しなおす
  if (cloudReady && store.group) syncAndRoute();

  $("group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("group-code-input");
    const code = normalizeGroupCode(input.value);
    if (!code) return;
    store.group = code;
    input.value = "";
    save();
    await syncAndRoute();
  });

  $("btn-change-group").addEventListener("click", () => {
    // 子どもが誤って押しても戻れるよう、消えるものを伝えてから確認する
    const ok = window.confirm(
      "ログアウトすると、あいことばと なまえを もういちど いれることになります。\n" +
        "きろくは のこっているので、おなじ あいことばを いれれば また みられます。\n\n" +
        "ログアウトしますか？"
    );
    if (!ok) return;
    store.group = null;
    store.current = null;
    state = null;
    cloudRecords = {};
    save();
    showScreen("screen-group");
  });

  $("player-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("player-name-input");
    const name = input.value.trim().slice(0, 10);
    if (!name) return;
    input.value = "";
    usePlayer(name);
    goHome();
  });

  $("player-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".player-list-item");
    if (!btn || playerEditMode) return;
    usePlayer(btn.dataset.name);
    goHome();
  });

  $("btn-switch-player").addEventListener("click", () => {
    store.current = null;
    state = null;
    save();
    enterPlayerScreen();
  });

  $("btn-stats").addEventListener("click", enterStats);
  $("btn-stats-back").addEventListener("click", goHome);
  $("btn-stats-start").addEventListener("click", startQuiz);

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
