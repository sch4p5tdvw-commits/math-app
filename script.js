// ===== レベル設定 =====
// レベル1: 1桁+1桁（こたえも1桁）
// レベル2: 1桁+1桁（こたえが2桁）
// レベル3: 1桁同士のひきざん（こたえは0いじょう）
// レベル4: 繰り下がりのある引き算（10〜19 － 1〜10、一の位が足りないもの）
// レベル5: 1桁同士のかけざん
// レベル6: 2桁×1桁のかけざん
// レベル7: 2桁以下÷1桁のわりざん（わりきれるもの）
// レベル8: 3桁÷1桁のわりざん（わりきれるもの）
const LEVELS = [
  { id: 1, hint: "1けた＋1けた（こたえも1けた）" },
  { id: 2, hint: "1けた＋1けた（こたえは2けた）" },
  { id: 3, hint: "1けたどうしの ひきざん" },
  { id: 4, hint: "10〜19からひく くりさがりの ある ひきざん" },
  { id: 5, hint: "1けたどうしの かけざん" },
  { id: 6, hint: "2けた×1けた の かけざん" },
  { id: 7, hint: "2けたいか÷1けた の わりざん" },
  { id: 8, hint: "3けた÷1けた の わりざん" },
];

// 画面では「レベル1〜8」ではなく、けいさんの しゅるいごとに 2レベルずつ見せる。
// 記録は これまでどおり 1〜8 の番号で保存するので、むかしの記録もそのまま使える。
// 色は 4つ ならんでも 見わけられることを たしかめてある。
const OPS = [
  { id: "add", sign: "＋", name: "たしざん", color: "#e0568c", levels: [1, 2] },
  { id: "sub", sign: "－", name: "ひきざん", color: "#2f7fd0", levels: [3, 4] },
  { id: "mul", sign: "×", name: "かけざん", color: "#d9821a", levels: [5, 6] },
  { id: "div", sign: "÷", name: "わりざん", color: "#2f8f6a", levels: [7, 8] },
];

// どちらのモードも設定はひとつだけ。記録どうしを比べられるようにするため、
// 問題数と制限時間は選ばせずに固定する。
const QUESTION_COUNT = 30;
const TIME_LIMIT_SEC = 60;
// こたえあわせを見せてから つぎの問題に移るまでの時間。
// せいかいのときは すぐ次へ進めたほうがテンポがよい。まちがえたときは
// 正しいこたえを読む時間がいるので、そのぶん長めに置く。
const NEXT_QUESTION_DELAY_MS = { correct: 260, wrong: 600 };

// モードごとの「よい記録」のきめかた。
// もんだいすうモードは タイムが みじかいほど、タイムアタックは 正解数が おおいほど よい。
const MODE_META = {
  normal: {
    id: "normal",
    name: "もんだいすう",
    setting: `${QUESTION_COUNT}もん`,
    unit: "びょう",
    better: "low",
    title: "クリアタイム",
    metric: (h) => h.elapsedSec,
  },
  timeattack: {
    id: "timeattack",
    name: "タイムアタック",
    setting: "1ぷん",
    unit: "もん",
    better: "high",
    title: "せいかいすう",
    metric: (h) => h.correct,
  },
};

function opOfLevel(level) {
  return OPS.find((op) => op.levels.includes(Number(level))) || null;
}

// 「ひきざん レベル2」のような、画面に出す名前
function levelLabel(level) {
  const op = opOfLevel(level);
  if (!op) return `レベル${level}`;
  return `${op.name} レベル${op.levels.indexOf(Number(level)) + 1}`;
}

function isBetter(value, than, better) {
  if (than === null || than === undefined) return true;
  return better === "low" ? value < than : value > than;
}

const HISTORY_KEY = "mathapp_history";
const PLAYER_KEY = "mathapp_current_player";
const PLAYER_LIST_KEY = "mathapp_player_list";
const ALIAS_KEY = "mathapp_player_aliases";
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
let soundBuffers = { correct: null, wrong: null };
let soundsLoading = false;
let currentSound = null; // いま鳴っている効果音 { source, gain }
let cloud = null; // { db, api } — クラウドが使えないときは null のまま
let cloudScoreCache = [];
let cloudPlayerCache = [];
let playerEditMode = false;
let historyEditMode = false;
let selectedLevel = 1;
let historyFilter = { op: "add", levelIndex: 0, mode: "normal" };
let countdownHandle = null;
let confettiHandle = null;

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

// 端末の中の なまえ と きろく は、あいことばごとに べつの場所へしまう。
// ひとつにまとめてしまうと、べつの あいことばで入ったときに まえの部屋の
// なまえや きろくが 見えてしまい、さらにそれが 新しい部屋のクラウドへ
// アップロードされて まざってしまう。
function scopedKey(baseKey) {
  const code = getGroupCode();
  return code ? `${baseKey}__${code}` : baseKey;
}

// むかしのバージョンは あいことばに関係なく ひとつの場所にしまっていた。
// いま入っている部屋のものとして 引っこしさせる。
function migrateLegacyGroupData() {
  const code = getGroupCode();
  if (!code) return;
  [HISTORY_KEY, PLAYER_LIST_KEY, ALIAS_KEY].forEach((baseKey) => {
    const legacy = localStorage.getItem(baseKey);
    if (legacy === null) return;
    const scoped = `${baseKey}__${code}`;
    // すでに引っこし先にデータがあるなら、そちらを優先して残す
    if (localStorage.getItem(scoped) === null) localStorage.setItem(scoped, legacy);
    localStorage.removeItem(baseKey);
  });
}

// 記録の意味が変わるアップデート時に、既存の記録を一度だけリセットする
function maybeResetHistory() {
  if (localStorage.getItem(DATA_VERSION_KEY) !== DATA_VERSION) {
    // どの部屋のものも まとめて消す
    Object.keys(localStorage)
      .filter((key) => key === HISTORY_KEY || key.startsWith(`${HISTORY_KEY}__`))
      .forEach((key) => localStorage.removeItem(key));
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
// あとで なまえを かえたり けしたり できるよう、
// サーバーが つけた キーを かえす。
async function pushPlayerToCloud(name) {
  if (!cloud || !getGroupCode()) return null;
  try {
    const res = await fetch(groupUrl("players"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    // Realtime Database は POST のこたえとして { name: "<キー>" } をかえす
    const data = await res.json();
    return data && typeof data.name === "string" ? data.name : null;
  } catch {
    // 送信できなくても端末内には残るので、そのまま続行する
    return null;
  }
}

// クラウド上の名前を { key, name, aka } の形でかえす。
// key は名前をかえたり消したりするときに必要。
// aka は「まえのなまえ」で、名前をかえても前の記録を見失わないために使う。
async function fetchPlayersFromCloud() {
  if (!cloud || !getGroupCode()) return [];
  try {
    const res = await fetch(groupUrl("players"));
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== "object") return [];
    return Object.entries(data)
      .filter(([, p]) => p && typeof p === "object" && typeof p.name === "string" && p.name)
      .map(([key, p]) => ({ key, name: p.name, aka: Object.keys(p.aka || {}) }));
  } catch {
    return [];
  }
}

async function writePlayerToCloud(key, value) {
  if (!cloud || !getGroupCode()) return;
  try {
    await fetch(`${cloud.baseUrl}/groups/${encodeURIComponent(getGroupCode())}/players/${key}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch {
    // つうしんに失敗しても端末内の変更はのこる
  }
}

async function deleteScoreFromCloud(key) {
  if (!cloud || !getGroupCode()) return;
  try {
    await fetch(`${cloud.baseUrl}/groups/${encodeURIComponent(getGroupCode())}/scores/${key}.json`, {
      method: "DELETE",
    });
  } catch {
    // つうしんに失敗しても端末内の変更はのこる
  }
}

async function deletePlayerFromCloud(key) {
  if (!cloud || !getGroupCode()) return;
  try {
    await fetch(`${cloud.baseUrl}/groups/${encodeURIComponent(getGroupCode())}/players/${key}.json`, {
      method: "DELETE",
    });
  } catch {
    // 同上
  }
}

// あとで1件ずつ消せるよう、サーバーが つけた キーを かえす。
async function pushScoreToCloud(entry) {
  if (!cloud || !getGroupCode()) return null;
  try {
    const { _key, ...payload } = entry;
    // POST するとサーバー側でキーが自動採番され、端末どうしがぶつからない
    const res = await fetch(scoresUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.name === "string" ? data.name : null;
  } catch {
    // 送信に失敗しても端末内には残っているので、そのまま続行する
    return null;
  }
}

async function fetchScoresFromCloud() {
  if (!cloud || !getGroupCode()) return [];
  try {
    const res = await fetch(scoresUrl());
    if (!res.ok) return [];
    const data = await res.json();
    // Realtime Database は { 自動キー: 記録, ... } の形でかえってくる。
    // あとで1件ずつ消せるよう、キーを _key としてもたせておく。
    if (!data || typeof data !== "object") return [];
    return Object.entries(data)
      .filter(([, v]) => v && typeof v === "object")
      .map(([key, v]) => ({ ...v, _key: key }));
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

// この端末にしかない名前と記録をクラウドへ送る。
// クラウドどうきを使う前から端末にあったデータや、電波がないあいだに
// できた記録は、これを通してはじめてほかの端末から見えるようになる。
async function uploadLocalDataToCloud() {
  if (!cloud || !getGroupCode()) return;

  const knownNames = new Set(cloudPlayerCache.map((p) => p.name));
  const missingNames = loadPlayerList().filter((n) => n && !knownNames.has(n));

  const knownIds = new Set(cloudScoreCache.map((s) => String(s.id)));
  const missingScores = loadHistory().filter((h) => h && h.id != null && !knownIds.has(String(h.id)));

  if (missingNames.length === 0 && missingScores.length === 0) return;

  const [addedNames, addedScores] = await Promise.all([
    Promise.all(missingNames.map(async (name) => ({ key: await pushPlayerToCloud(name), name, aka: [] }))),
    // キーを控えておかないと、あとでこの記録を消せなくなる
    Promise.all(missingScores.map(async (s) => ({ ...s, _key: await pushScoreToCloud(s) }))),
  ]);

  cloudPlayerCache = [...cloudPlayerCache, ...addedNames];
  cloudScoreCache = mergeScores(cloudScoreCache, addedScores);
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

// mp3 を Audio 要素で鳴らすと、スマホでは押してから音が出るまでに
// もたつくことがある。あらかじめ音を読みこんでおき、Web Audio で
// 鳴らすと待ち時間がほぼなくなる。読みこめなかったときだけ
// Audio 要素 →（それも駄目なら）合成音、の順にさかのぼる。
function preloadSounds() {
  if (soundsLoading) return;
  soundsLoading = true;
  const ctx = getAudioContext();
  if (!ctx) return;
  [
    ["correct", "sounds/correct.mp3"],
    ["wrong", "sounds/wrong.mp3"],
  ].forEach(([key, url]) => {
    fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        soundBuffers[key] = buffer;
      })
      .catch(() => {
        // 読みこめなくても Audio 要素で鳴らせるので、そのまま続行する
      });
  });
}

// 鳴らしっぱなしの音を止める。ぶつっと切れないよう、ほんの少しだけ
// 音量を下げてから止める。
function stopCurrentSound(ctx) {
  if (!currentSound) return;
  const now = ctx.currentTime;
  try {
    currentSound.gain.gain.setValueAtTime(currentSound.gain.gain.value, now);
    currentSound.gain.gain.linearRampToValueAtTime(0, now + 0.02);
    currentSound.source.stop(now + 0.03);
  } catch {
    // もう止まっていた場合
  }
  currentSound = null;
}

function playBufferedSound(key) {
  const buffer = soundBuffers[key];
  if (!buffer) return false;
  const ctx = getAudioContext();
  if (!ctx) return false;
  // つぎつぎ正解したときに音が かさなって にごらないよう、
  // 前の効果音は止めてから鳴らす（Audio 要素のときと同じ鳴りかた）
  stopCurrentSound(ctx);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
  currentSound = { source, gain };
  source.onended = () => {
    if (currentSound && currentSound.source === source) currentSound = null;
  };
  return true;
}

function playSynthCorrectSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.15, "sine", 0.25); // ピン
  playTone(ctx, 659, now + 0.15, 0.3, "sine", 0.25); // ポーン
}

function playCorrectSound() {
  if (playBufferedSound("correct")) return;
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
  if (playBufferedSound("wrong")) return;
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
    // 10〜19 から 1〜10 を引くうち、くりさがりが必要なものだけ。
    // 一の位どうしをくらべて、引かれる側が小さいときが「くりさがり」。
    // 引く数が10のときは一の位が0なので、くりさがりは起きない（＝出題されない）。
    for (let a = 10; a <= 19; a++) {
      for (let b = 1; b <= 10; b++) {
        if (a % 10 < b % 10) problems.push({ text: `${a} － ${b} = ?`, answer: a - b });
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
    return JSON.parse(localStorage.getItem(scopedKey(HISTORY_KEY))) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(scopedKey(HISTORY_KEY), JSON.stringify(history.slice(0, 30)));
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
    return JSON.parse(localStorage.getItem(scopedKey(PLAYER_LIST_KEY))) || [];
  } catch {
    return [];
  }
}

function rememberPlayer(name) {
  const list = loadPlayerList().filter((n) => n !== name);
  list.unshift(name);
  localStorage.setItem(scopedKey(PLAYER_LIST_KEY), JSON.stringify(list.slice(0, 20)));
}

// 端末に登録済みの名前に、クラウド上の同じグループの名前も合わせて出す。
// これで新しい端末でも、あいことばを入れれば家族の名前がそのまま選べる。
function allKnownPlayerNames() {
  const names = loadPlayerList();
  const seen = new Set(names);
  // クラウドに登録された名前と、記録にふくまれる名前の両方から拾う
  const fromCloud = cloudPlayerCache.map((p) => p.name);
  fromCloud.forEach((name) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  });
  return names;
}

// なまえをかえたとき、まえのなまえも おぼえておく。
// 記録は なまえで ひもづいているので、これがないと かえたとたんに
// それまでの記録が見えなくなってしまう。
function loadAliases() {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(ALIAS_KEY))) || {};
  } catch {
    return {};
  }
}

function saveAliases(map) {
  localStorage.setItem(scopedKey(ALIAS_KEY), JSON.stringify(map));
}

// その人が今まで使ったすべてのなまえ（今のなまえ＋まえのなまえ）
function namesOf(player) {
  const local = loadAliases()[player] || [];
  const cloudEntry = cloudPlayerCache.find((p) => p.name === player);
  return [player, ...local, ...(cloudEntry ? cloudEntry.aka : [])].filter(
    (n, i, arr) => n && arr.indexOf(n) === i
  );
}

function countRecordsOf(player) {
  const names = new Set(namesOf(player));
  return mergeScores(cloudScoreCache, loadHistory()).filter((h) => h && names.has(h.name)).length;
}

function renamePlayer(oldName, newName) {
  // 端末内: 一覧・まえのなまえ・いま選んでいる人 をまとめて付けかえる
  const list = loadPlayerList().map((n) => (n === oldName ? newName : n));
  localStorage.setItem(scopedKey(PLAYER_LIST_KEY), JSON.stringify(list));

  const aliases = loadAliases();
  const previous = aliases[oldName] || [];
  delete aliases[oldName];
  aliases[newName] = [...new Set([...previous, oldName])];
  saveAliases(aliases);

  if (getCurrentPlayer() === oldName) setCurrentPlayer(newName);

  // クラウド: 同じ場所を書きかえ、まえのなまえを aka にのこす
  const entry = cloudPlayerCache.find((p) => p.name === oldName);
  const aka = [...new Set([...(entry ? entry.aka : []), ...previous, oldName])];
  cloudPlayerCache = cloudPlayerCache.map((p) =>
    p.name === oldName ? { ...p, name: newName, aka } : p
  );
  if (entry && entry.key) {
    const akaMap = {};
    aka.forEach((n) => (akaMap[n] = true));
    writePlayerToCloud(entry.key, { name: newName, aka: akaMap });
  } else {
    const created = cloudPlayerCache.find((p) => p.name === newName);
    pushPlayerToCloud(newName).then((key) => {
      if (key && created) created.key = key;
    });
  }
}

function deletePlayer(name) {
  localStorage.setItem(
    scopedKey(PLAYER_LIST_KEY),
    JSON.stringify(loadPlayerList().filter((n) => n !== name))
  );
  const aliases = loadAliases();
  delete aliases[name];
  saveAliases(aliases);

  const entry = cloudPlayerCache.find((p) => p.name === name);
  cloudPlayerCache = cloudPlayerCache.filter((p) => p.name !== name);
  if (entry && entry.key) deletePlayerFromCloud(entry.key);

  if (getCurrentPlayer() === name) clearCurrentPlayer();
}

function handleRenamePlayer(oldName) {
  const input = window.prompt(`「${oldName}」の あたらしい なまえを いれてね`, oldName);
  if (input === null) return;
  const newName = input.trim().slice(0, 10);
  if (!newName || newName === oldName) return;
  if (allKnownPlayerNames().some((n) => n === newName)) {
    window.alert(`「${newName}」は すでに つかわれています。`);
    return;
  }
  renamePlayer(oldName, newName);
  renderPlayerList();
}

function handleDeletePlayer(name) {
  // きろくの数を見せたうえで確認する。まちがって消しても、
  // きろく自体はのこっていて 同じなまえを つくれば また見られる。
  const count = countRecordsOf(name);
  const ok = window.confirm(
    `「${name}」を いちらんから けしますか？\n\n` +
      `${count}かいぶんの きろくが あります。\n` +
      `きろくは のこるので、おなじ なまえを つくれば また みられます。`
  );
  if (!ok) return;
  deletePlayer(name);
  renderPlayerList();
}

function renderPlayerList() {
  const container = document.getElementById("player-list");
  container.innerHTML = "";
  const names = allKnownPlayerNames();
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
  toggle.className = "btn-link";
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
    btn.textContent = `\u{1F464} ${name}`;
    btn.dataset.name = name;
    // へんしゅう中は えらべないようにして、あやまって始めてしまうのを防ぐ
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

function selectPlayer(name) {
  rememberPlayer(name);
  setCurrentPlayer(name);
  if (!cloudPlayerCache.some((p) => p.name === name)) {
    const pending = { key: null, name, aka: [] };
    cloudPlayerCache = [...cloudPlayerCache, pending];
    // キーが返ってきたら控えておく（あとで名前変更・削除するのに要る）
    pushPlayerToCloud(name).then((key) => {
      if (key) pending.key = key;
    });
  }
  enterStartScreen();
}

// ===== 画面切り替え =====
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => (el.hidden = true));
  document.getElementById(id).hidden = false;
}

// ===== スタート画面 =====
function getSelectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "normal";
}

function getSelectedLevel() {
  return selectedLevel;
}

// けいさんの しゅるいごとに、レベル1・2 の 2つを ならべる。
// マスの中には、いま えらんでいる モードでの さいこうきろくを 出す。
function renderOpGroups() {
  const meta = MODE_META[getSelectedMode()];
  const best = computeBestRecords(playerEntries());
  const container = document.getElementById("op-groups");

  container.innerHTML = OPS.map((op) => {
    const cells = op.levels
      .map((level, i) => {
        const record = best[level] ? best[level][meta.id] : null;
        const bestText = record ? `さいこう ${meta.metric(record)}${meta.unit}` : "きろくなし";
        return `<button type="button" class="lv${level === selectedLevel ? " selected" : ""}"
            data-level="${level}" aria-pressed="${level === selectedLevel}">
            <strong>レベル${i + 1}</strong>
            <span class="best">${bestText}</span>
          </button>`;
      })
      .join("");
    return `<div class="op-group" style="--op: ${op.color}">
        <div class="op-head">
          <span class="op-sign">${op.sign}</span>
          <span class="op-name">${op.name}</span>
        </div>
        <div class="op-levels">${cells}</div>
      </div>`;
  }).join("");
}

// この人の記録だけを、新しい順にそろえる
function playerEntries() {
  // まえのなまえの記録もふくめる（なまえをかえても記録が消えないように）
  const names = new Set(namesOf(getCurrentPlayer()));
  return mergeScores(cloudScoreCache, loadHistory())
    .filter((h) => h && names.has(h.name))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// レベルごとの自己ベスト。もんだいすうモードはクリアタイムが短いほど、
// タイムアタックは正解数が多いほど良い記録とする。
function computeBestRecords(entries) {
  const best = {};
  LEVELS.forEach((lv) => (best[lv.id] = { normal: null, timeattack: null }));
  entries.forEach((h) => {
    const slot = best[h.level];
    if (!slot) return;
    if (h.mode === "timeattack") {
      if (!slot.timeattack || h.correct > slot.timeattack.correct) slot.timeattack = h;
    } else if (!slot.normal || h.elapsedSec < slot.normal.elapsedSec) {
      slot.normal = h;
    }
  });
  return best;
}

function deleteRecord(entry) {
  // 端末内から消す
  const kept = loadHistory().filter((h) => String(h.id) !== String(entry.id));
  saveHistory(kept);
  // クラウドからも消す（キーがあるとき＝クラウドに上がっている記録）
  cloudScoreCache = cloudScoreCache.filter((h) => String(h.id) !== String(entry.id));
  if (entry._key) deleteScoreFromCloud(entry._key);
}

function handleDeleteRecord(entry) {
  const when = formatDate(entry.date);
  const what =
    entry.mode === "timeattack"
      ? `${entry.correct}もん（${entry.timeLimit}びょう）`
      : `${entry.elapsedSec}びょう（${entry.total}もん）`;
  const ok = window.confirm(
    `この きろくを けしますか？\n\n${when}\n${levelLabel(entry.level)}・${what}\n\n` +
      `けすと もとに もどせません。`
  );
  if (!ok) return;
  deleteRecord(entry);
  renderHistory();
}

// ===== これまでのきろく =====
function historyLevel() {
  const op = OPS.find((o) => o.id === historyFilter.op) || OPS[0];
  return op.levels[historyFilter.levelIndex] || op.levels[0];
}

// スタート画面で えらんでいる レベルとモードを、そのまま きろく画面の
// はじめの ひょうじに つかう
function syncHistoryFilterToSelection() {
  const op = opOfLevel(selectedLevel) || OPS[0];
  historyFilter = {
    op: op.id,
    levelIndex: Math.max(0, op.levels.indexOf(selectedLevel)),
    mode: getSelectedMode(),
  };
}

function renderHistoryChips() {
  const op = OPS.find((o) => o.id === historyFilter.op) || OPS[0];

  document.getElementById("filter-op").innerHTML = OPS.map(
    (o) => `<button type="button" class="chip" data-op="${o.id}" style="--op: ${o.color}"
      aria-pressed="${o.id === historyFilter.op}">${o.sign}${o.name}</button>`
  ).join("");

  const levels = document.getElementById("filter-level");
  levels.style.setProperty("--op", op.color);
  levels.innerHTML = [0, 1]
    .map(
      (i) => `<button type="button" class="chip" data-level-index="${i}"
        aria-pressed="${i === historyFilter.levelIndex}">レベル${i + 1}</button>`
    )
    .join("");

  const modes = document.getElementById("filter-mode");
  modes.style.setProperty("--op", op.color);
  modes.innerHTML = Object.values(MODE_META)
    .map(
      (m) => `<button type="button" class="chip" data-mode="${m.id}"
        aria-pressed="${m.id === historyFilter.mode}">${m.name}</button>`
    )
    .join("");
}

function renderHistory() {
  document.getElementById("history-title").textContent = `${getCurrentPlayer()} さんのきろく`;
  renderHistoryChips();

  const op = OPS.find((o) => o.id === historyFilter.op) || OPS[0];
  const level = historyLevel();
  const meta = MODE_META[historyFilter.mode];
  const body = document.getElementById("history-body");

  // ふるい順に ならべると、そのまま「よくなってきたか」の ながれになる
  const entries = playerEntries()
    .filter((h) => Number(h.level) === level && h.mode === meta.id)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (entries.length === 0) {
    historyEditMode = false;
    body.innerHTML = `<div class="history-empty">${levelLabel(level)}・${meta.name}モードの きろくは まだ ないよ</div>`;
    return;
  }

  const values = entries.map(meta.metric);
  const bestValue = meta.better === "low" ? Math.min(...values) : Math.max(...values);
  const first = values[0];
  const latest = values[values.length - 1];
  const gained = meta.better === "low" ? first - bestValue : bestValue - first;
  const verb = meta.better === "low" ? "はやくなった" : "ふえた";

  const rows = entries
    .map((h, i) => {
      const value = meta.metric(h);
      const tag = value === bestValue ? '<span class="history-tag">さいこう</span>' : "";
      const del = historyEditMode
        ? `<button type="button" class="player-edit-btn player-delete-btn" data-del="${h.id}" title="この きろくを けす">\u{1F5D1}️</button>`
        : "";
      return `<div class="history-item">
          <span class="history-main">${formatDate(h.date)}<small>${i + 1}かいめ・せいかいりつ ${h.accuracy}%</small></span>
          ${tag}
          <span class="history-score">${value}${meta.unit}</span>
          ${del}
        </div>`;
    })
    .reverse()
    .join("");

  body.innerHTML = `
    <div class="summary" style="--op: ${op.color}">
      <div class="tile"><div class="tile-k">さいこうきろく</div>
        <div class="tile-v tile-best">${bestValue}<span>${meta.unit}</span></div></div>
      <div class="tile"><div class="tile-k">さいきん</div>
        <div class="tile-v">${latest}<span>${meta.unit}</span></div></div>
    </div>
    ${
      gained > 0
        ? `<div class="gain"><div class="gain-k">はじめの ${first}${meta.unit} から</div>
             <div class="gain-v">${gained}${meta.unit} ${verb}！</div></div>`
        : `<div class="gain flat"><div class="gain-k">はじめの ${first}${meta.unit} から</div>
             <div class="gain-v">これから のびるよ</div></div>`
    }
    <figure class="chart-figure">
      <figcaption>${meta.title}の うつりかわり（うえに いくほど よい）</figcaption>
      ${renderChart(values, op.color, meta)}
    </figure>
    <div class="history-log-head">
      <span class="player-list-label">${
        historyEditMode ? "けしたい きろくを えらんでね" : `ぜんぶで ${entries.length}かい`
      }</span>
      <button type="button" class="btn-link" id="history-edit-toggle">${
        historyEditMode ? "おわり" : "へんしゅう"
      }</button>
    </div>
    <div class="history-log">${rows}</div>`;

  document.getElementById("history-edit-toggle").addEventListener("click", () => {
    historyEditMode = !historyEditMode;
    renderHistory();
  });
  body.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = entries.find((h) => String(h.id) === btn.dataset.del);
      if (entry) handleDeleteRecord(entry);
    });
  });
}

// 記録の うつりかわりを 折れ線で見せる。1つの系列だけなので凡例はいらない。
// どちらのモードでも「よい記録ほど上」になるよう、タイムのときは たてじくを 反転する。
function renderChart(values, color, meta) {
  const W = 380;
  const H = 190;
  const P = { t: 34, r: 16, b: 30, l: 40 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const lowerIsBetter = meta.better === "low";

  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = Math.max(lowerIsBetter ? 6 : 2, Math.round((max - min) * 0.25));
  const lo = Math.max(0, min - pad);
  const hi = max + pad;

  const x = (i) => P.l + (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
  const y = (v) => {
    const t = (v - lo) / (hi - lo || 1);
    return P.t + (lowerIsBetter ? t : 1 - t) * ih;
  };

  const grid = [lo, (lo + hi) / 2, hi]
    .map((v) => Math.round(v))
    .map(
      (v) => `<line x1="${P.l}" y1="${y(v).toFixed(1)}" x2="${W - P.r}" y2="${y(v).toFixed(1)}"
        stroke="#ece7df" stroke-width="1"/>
      <text x="${P.l - 7}" y="${(y(v) + 4).toFixed(1)}" font-size="10" fill="#a9a29a"
        text-anchor="end">${v}</text>`
    )
    .join("");

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const base = P.t + ih;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;

  const bestI = values.indexOf(lowerIsBetter ? min : max);
  const lastI = values.length - 1;

  // 5とがりの星。さいこうの点だけ 星にして ひと目で わかるようにする
  const star = (cx, cy, r) => {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 ? r * 0.44 : r;
      const ang = (Math.PI / 5) * k - Math.PI / 2;
      pts.push(`${(cx + rad * Math.cos(ang)).toFixed(1)},${(cy + rad * Math.sin(ang)).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  const dots = values
    .map((v, i) => {
      const cx = x(i);
      const cy = y(v);
      const tip = `<title>${i + 1}かいめ ${v}${meta.unit}</title>`;
      if (i === bestI) {
        // 線の上に のせるので、白いふちどりで うかせる
        return `<polygon points="${star(cx, cy, 10)}" fill="${color}" stroke="#fff"
          stroke-width="2" stroke-linejoin="round">${tip}</polygon>`;
      }
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${i === lastI ? 6 : 3.5}"
        fill="${i === lastI ? color : "#fff"}" stroke="${color}" stroke-width="2">${tip}</circle>`;
    })
    .join("");

  // 文字を出すのは さいこう と さいきん だけ。はしでは よせを かえて はみ出しを ふせぐ
  const label = (i, text, yy) => {
    const px = x(i);
    const anchor = px < P.l + 36 ? "start" : px > W - P.r - 36 ? "end" : "middle";
    const nudge = anchor === "start" ? -4 : anchor === "end" ? 4 : 0;
    return `<text x="${(px + nudge).toFixed(1)}" y="${yy.toFixed(1)}" font-size="10.5"
      font-weight="700" fill="${color}" text-anchor="${anchor}">${text}</text>`;
  };
  // よい記録ほど上なので、さいこうの点の上は かならず あいている
  const labelBest = label(bestI, `さいこう ${values[bestI]}`, y(values[bestI]) - 15);
  const labelLast = lastI === bestI ? "" : label(lastI, `さいきん ${values[lastI]}`, y(values[lastI]) + 17);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${meta.title}の うつりかわり。はじめ ${values[0]}${meta.unit}、さいこう ${values[bestI]}${meta.unit}。うえに いくほど よい記録。">
    ${grid}
    <path d="${area}" fill="${color}" opacity="0.1"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labelBest}${labelLast}
    <text x="${P.l}" y="${H - 9}" font-size="10" fill="#a9a29a">1かいめ</text>
    ${
      values.length > 1
        ? `<text x="${W - P.r}" y="${H - 9}" font-size="10" fill="#a9a29a" text-anchor="end">${values.length}かいめ</text>`
        : ""
    }
  </svg>`;
}

// ===== カウントダウン =====
function playCountdownTick(isGo) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  if (isGo) {
    playTone(ctx, 880, now, 0.28, "sine", 0.22);
    playTone(ctx, 1320, now + 0.05, 0.3, "sine", 0.16);
  } else {
    playTone(ctx, 620, now, 0.12, "sine", 0.18);
  }
}

// 3・2・1・スタート！ を出してから はじめる。
// タイマーも 出題も、カウントダウンが おわってから うごきだす。
function runCountdown(label, onDone) {
  const overlay = document.getElementById("countdown");
  const num = document.getElementById("countdown-num");
  document.getElementById("countdown-label").textContent = label;
  const steps = ["3", "2", "1", "スタート！"];
  let i = 0;

  if (countdownHandle) clearTimeout(countdownHandle);
  overlay.hidden = false;

  const tick = () => {
    if (i >= steps.length) {
      countdownHandle = null;
      overlay.hidden = true;
      onDone();
      return;
    }
    num.textContent = steps[i];
    num.classList.toggle("go", i === steps.length - 1);
    // 同じアニメーションを もう一度 さいせいさせる
    num.classList.remove("pop");
    void num.offsetWidth;
    num.classList.add("pop");
    playCountdownTick(i === steps.length - 1);
    i += 1;
    countdownHandle = setTimeout(tick, 700);
  };
  tick();
}

// ===== クイズ開始 =====
function startQuiz() {
  const level = getSelectedLevel();
  const mode = getSelectedMode();
  // スタートを押した瞬間に効果音を読みこむ。カウントダウンの
  // あいだに用意できるので、1問目から待たされない。
  preloadSounds();

  state = {
    level,
    mode,
    correct: 0,
    wrong: 0,
    index: 0,
    total: mode === "normal" ? QUESTION_COUNT : Infinity,
    timeLimit: mode === "timeattack" ? TIME_LIMIT_SEC : null,
    timeLeft: mode === "timeattack" ? TIME_LIMIT_SEC : null,
    startedAt: null, // カウントダウンが おわった ときに いれる
    timerHandle: null,
    currentAnswer: null,
    inputBuffer: "",
    transitioning: false,
    finished: false,
  };

  showScreen("screen-quiz");
  document.getElementById("quiz-timer").textContent = mode === "timeattack" ? `⏱ ${state.timeLeft}s` : "";
  nextQuestion();
  // カウントダウン中は こたえられないようにしておく
  state.transitioning = true;

  const started = state;
  const countdownLabel = `${levelLabel(level)}・${MODE_META[mode].setting}`;
  runCountdown(countdownLabel, () => {
    // カウントダウン中に べつのゲームが はじまっていたら なにもしない
    if (state !== started || state.finished) return;
    state.startedAt = Date.now();
    state.transitioning = false;

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
  });
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
  const question = document.getElementById("quiz-question");
  question.textContent = problem.text;
  // 前の問題と入れかわったことが ふっと分かるように、短く出しなおす。
  // 同じアニメーションを もう一度 さいせいさせるため、いったん外す。
  question.classList.remove("swap");
  void question.offsetWidth;
  question.classList.add("swap");
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
  const isCorrect = value === state.currentAnswer;

  if (isCorrect) {
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
  }, isCorrect ? NEXT_QUESTION_DELAY_MS.correct : NEXT_QUESTION_DELAY_MS.wrong);
}

function finishQuiz() {
  // タイマーと、まだ残っている画面切りかえ待ちの両方から呼ばれうるので、
  // 記録が二重に保存されないよう一度だけ実行する
  if (!state || state.finished) return;
  state.finished = true;
  if (state.timerHandle) clearInterval(state.timerHandle);
  const totalAnswered = state.correct + state.wrong;
  const accuracy = totalAnswered > 0 ? Math.round((state.correct / totalAnswered) * 100) : 0;
  const rawElapsedSec = Math.round((Date.now() - (state.startedAt || Date.now())) / 1000);
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
  // 保存する まえに くらべないと、いまの記録自体が「これまでの さいこう」に
  // なってしまい、こうしんに 気づけなくなる
  const achievement = judgeAchievement(entry);

  saveHistoryEntry(entry);
  const cached = { ...entry };
  cloudScoreCache = mergeScores(cloudScoreCache, [cached]);
  pushScoreToCloud(entry).then((key) => {
    if (key) cached._key = key;
  });

  renderResult(entry, achievement);
  showScreen("screen-result");
  if (achievement) celebrate();
}

// これまでの さいこうきろくと くらべて、はじめての きろくか、
// こうしんか、そうでないかを かえす
function judgeAchievement(entry) {
  const meta = MODE_META[entry.mode];
  const slot = computeBestRecords(playerEntries())[entry.level];
  const previous = slot ? slot[entry.mode] : null;
  const value = meta.metric(entry);
  if (!previous) return { kind: "first", value, meta };
  if (!isBetter(value, meta.metric(previous), meta.better)) return null;
  return { kind: "best", value, previous: meta.metric(previous), meta };
}

function renderResult(entry, achievement) {
  document.getElementById("result-title").textContent =
    entry.mode === "timeattack" ? "タイムアタック けっか" : "けっか";

  const banner = document.getElementById("result-celebration");
  if (achievement) {
    const meta = achievement.meta;
    banner.hidden = false;
    banner.innerHTML =
      achievement.kind === "best"
        ? `<div class="celebration-title">🎉 さいこうきろく こうしん！ 🎉</div>
           <div class="celebration-sub">これまでの ${achievement.previous}${meta.unit} → <b>${achievement.value}${meta.unit}</b></div>`
        : `<div class="celebration-title">🎉 はじめての きろく！ 🎉</div>
           <div class="celebration-sub">${levelLabel(entry.level)}・${meta.name}モード ${achievement.value}${meta.unit}</div>`;
  } else {
    banner.hidden = true;
    banner.innerHTML = "";
  }

  const levelInfo = LEVELS.find((l) => l.id === entry.level);
  let timeLine;
  if (entry.mode === "timeattack") {
    timeLine = `<div>せいげんじかん: ${MODE_META.timeattack.setting}</div>`;
  } else if (entry.wrong > 0) {
    timeLine = `<div>クリアタイム: ${entry.elapsedSec}びょう (じっさい${entry.rawElapsedSec}びょう + まちがい${entry.wrong}問 × ${WRONG_ANSWER_PENALTY_SEC}びょう)</div>`;
  } else {
    timeLine = `<div>クリアタイム: ${entry.elapsedSec}びょう</div>`;
  }

  document.getElementById("result-stats").innerHTML = `
    <div class="big">${entry.correct} もん せいかい！</div>
    <div>せいかいりつ: ${entry.accuracy}%</div>
    <div>といたもんすう: ${entry.total}もん (まちがい ${entry.wrong}もん)</div>
    <div>${levelLabel(entry.level)} (${levelInfo ? levelInfo.hint : ""})</div>
    ${timeLine}
  `;
}

// ===== クラッカー =====
function playFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 1500, now, 0.06, "square", 0.12); // パンッ
  [523, 659, 784, 1047].forEach((freq, i) => {
    playTone(ctx, freq, now + 0.08 + i * 0.1, 0.22, "triangle", 0.2);
  });
}

// 左下と右下から 紙ふぶきを ななめに うちあげる
function celebrate() {
  playFanfare();
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.getElementById("confetti");
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

  const colors = ["#e0568c", "#2f7fd0", "#d9821a", "#2f8f6a", "#ffd23f", "#9b5de5"];
  const pieces = [];
  [
    { x: 10, y: h - 10, dir: 1 },
    { x: w - 10, y: h - 10, dir: -1 },
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
        color: colors[Math.floor(Math.random() * colors.length)],
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
  const canvas = document.getElementById("confetti");
  canvas.hidden = true;
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
  stopCelebration();
  renderPlayerBar();
  renderGroupBar();
  renderOpGroups();
  showScreen("screen-start");
}

function enterPlayerScreen() {
  playerEditMode = false;
  renderPlayerList();
  showScreen("screen-player");
}

// あいことばが決まったら、クラウドから記録を読み直してから次の画面へ進む
async function syncAndRoute() {
  await refreshCloudScores();
  await uploadLocalDataToCloud();
  if (getCurrentPlayer()) {
    enterStartScreen();
  } else {
    enterPlayerScreen();
  }
}

async function init() {
  migrateLegacyGroupData();
  maybeResetHistory();
  renderOpGroups();

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
    // クラウドを使う前からこの端末にあったデータは、はじめて入った部屋の
    // ものとして引きつぐ。2回目からは引っこすものがないので、べつの部屋に
    // 入っても まざらない。
    migrateLegacyGroupData();
    input.value = "";
    await syncAndRoute();
  });

  document.getElementById("btn-change-group").addEventListener("click", () => {
    // 子どもが誤って押しても戻れるよう、消えるものを伝えてから確認する
    const ok = window.confirm(
      "ログアウトすると、あいことばと なまえを もういちど いれることになります。\n" +
        "きろくは のこっているので、おなじ あいことばを いれれば また みられます。\n\n" +
        "ログアウトしますか？"
    );
    if (!ok) return;
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
    if (!btn || playerEditMode) return;
    selectPlayer(btn.dataset.name);
  });

  document.getElementById("btn-switch-player").addEventListener("click", () => {
    clearCurrentPlayer();
    enterPlayerScreen();
  });

  document.getElementById("op-groups").addEventListener("click", (e) => {
    const btn = e.target.closest(".lv");
    if (!btn) return;
    selectedLevel = Number(btn.dataset.level);
    renderOpGroups();
  });

  // モードによって「よい記録」の意味が変わるので、マスの中の
  // さいこうきろくも あわせて 出しなおす
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", renderOpGroups);
  });

  document.getElementById("btn-history").addEventListener("click", () => {
    historyEditMode = false;
    syncHistoryFilterToSelection();
    renderHistory();
    showScreen("screen-history");
  });

  document.getElementById("filter-op").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    historyFilter.op = chip.dataset.op;
    historyEditMode = false;
    renderHistory();
  });

  document.getElementById("filter-level").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    historyFilter.levelIndex = Number(chip.dataset.levelIndex);
    historyEditMode = false;
    renderHistory();
  });

  document.getElementById("filter-mode").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    historyFilter.mode = chip.dataset.mode;
    historyEditMode = false;
    renderHistory();
  });

  document.getElementById("btn-history-back").addEventListener("click", enterStartScreen);

  document.getElementById("btn-start").addEventListener("click", startQuiz);

  // 指を はなす まで待たずに、ふれた その瞬間に 反応させる。
  // click だと touchend のあとになるぶん、わずかに もたついて感じる。
  const keypad = document.getElementById("keypad");
  const onKey = (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    handleKeyPress(btn.dataset.key);
  };
  if (window.PointerEvent) {
    keypad.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary) return; // 右クリックや 2本目の指は むし
      onKey(e);
    });
  } else {
    keypad.addEventListener("click", onKey);
  }
  document.getElementById("btn-retry").addEventListener("click", () => {
    stopCelebration();
    startQuiz();
  });
  document.getElementById("btn-back").addEventListener("click", enterStartScreen);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
