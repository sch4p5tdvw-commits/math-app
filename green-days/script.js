"use strict";

/*
 * グリーンデイズ 売上・在庫管理アプリ
 * データはすべて localStorage（この端末のブラウザ内）だけに保存され、
 * どこにも送信されません。ネットワーク通信は一切行いません。
 */

// 画面に出す版。直したはずの動きが変わらないとき、スマホが古いものを
// 掴んでいるのか、直し方が足りないのかを切り分けるために使う。
const APP_VERSION = "2026-08-27g";

const STORAGE_KEY = "greenDays.v1";
const SNAPSHOT_KEY = "greenDays.snapshots.v1";
const BACKUP_META_KEY = "greenDays.backupMeta.v1";
const CHANGE_COUNT_KEY = "greenDays.changeCount.v1";

const MAX_SNAPSHOTS = 5;
const BACKUP_REMINDER_DAYS = 7;
// 日数だけを見ていると、短期間にたくさん入力した分が催促されないまま残る
const BACKUP_REMINDER_RECORDS = 20;

/** @type {{products: Array, sales: Array, restocks: Array}} */
let db = loadDB();

let currentReportRange = "today";

// ---------- ユーティリティ ----------

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatYen(n) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function emptyDB() {
  return { stores: [], products: [], sales: [], restocks: [] };
}

/**
 * 読み込んだデータを今の形にそろえる。
 * 店舗を持たない古いデータは「本店」ひとつに寄せる。
 */
function normalizeDB(parsed) {
  const next = {
    stores: Array.isArray(parsed.stores) ? parsed.stores : [],
    products: Array.isArray(parsed.products) ? parsed.products : [],
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    restocks: Array.isArray(parsed.restocks) ? parsed.restocks : [],
  };

  const hasContent = next.products.length > 0 || next.sales.length > 0 || next.restocks.length > 0;
  let fallback = next.stores[0] || null;
  if (!fallback && hasContent) {
    fallback = { id: uid(), name: "本店", createdAt: Date.now() };
    next.stores.push(fallback);
  }

  next.products.forEach((p) => {
    if (!Array.isArray(p.aliases)) p.aliases = [];
    if (!p.stockByStore || typeof p.stockByStore !== "object") {
      p.stockByStore = {};
      if (typeof p.stock === "number" && fallback) p.stockByStore[fallback.id] = p.stock;
    }
    delete p.stock;
  });

  [next.sales, next.restocks].forEach((list) => {
    list.forEach((row) => {
      if (!row.storeId && fallback) {
        row.storeId = fallback.id;
        row.storeName = fallback.name;
      }
    });
  });

  return next;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDB();
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    console.error("データの読み込みに失敗しました", e);
    return emptyDB();
  }
}

function findStore(id) {
  return db.stores.find((s) => s.id === id) || null;
}

function getStock(product, storeId) {
  if (!product || !product.stockByStore) return 0;
  return Number(product.stockByStore[storeId]) || 0;
}

function setStock(product, storeId, qty) {
  if (!product.stockByStore) product.stockByStore = {};
  product.stockByStore[storeId] = qty;
}

function addStock(product, storeId, delta) {
  setStock(product, storeId, getStock(product, storeId) + delta);
}

function totalStock(product) {
  if (!product || !product.stockByStore) return 0;
  return Object.values(product.stockByStore).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/**
 * 商品ごとの在庫。合計と、店舗ごとの内訳を添えて返す。
 * その店舗で扱ったことのある商品だけを内訳に出す。すべての組み合わせを
 * 見ると、置いていない商品が在庫0として大量に並んでしまうため。
 */
function stockOverview() {
  return db.products.map((product) => {
    const perStore = [];
    db.stores.forEach((store) => {
      if (!product.stockByStore || !Object.prototype.hasOwnProperty.call(product.stockByStore, store.id)) return;
      perStore.push({ store, qty: getStock(product, store.id) });
    });
    const total = perStore.reduce((sum, e) => sum + e.qty, 0);
    return { product, perStore, total };
  });
}

/** select 要素に店舗の一覧を入れる */
function fillStoreSelect(select, selectedId) {
  select.innerHTML = "";
  if (db.stores.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "先に「設定」で店舗を登録してください";
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
    return;
  }
  db.stores.forEach((store) => {
    const opt = document.createElement("option");
    opt.value = store.id;
    opt.textContent = store.name;
    if (store.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * 保存のたびに増える通し番号。バックアップ時の値と比べることで
 * 「書き出したあと何回変えたか」が分かる。件数の差だけを見ていると、
 * 足した数と消した数が同じときに変更が無かったことになってしまう。
 */
let changeCounter = (() => {
  const raw = Number(localStorage.getItem(CHANGE_COUNT_KEY));
  return Number.isFinite(raw) ? raw : 0;
})();

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    changeCounter += 1;
    localStorage.setItem(CHANGE_COUNT_KEY, String(changeCounter));
  } catch (e) {
    // 保存できないまま操作を続けると、記録したつもりのものが消える。
    // 黙って失敗させず、必ず知らせて書き出しを促す。
    console.error("保存に失敗しました", e);
    alert(
      "データを保存できませんでした。端末の空き容量が足りない可能性があります。\n\n" +
        "「設定」→「バックアップを送る・保存する」で今のデータを書き出してから、" +
        "不要な写真やアプリを整理してください。"
    );
    return false;
  }
  maybeAutoSnapshot();
  updateBackupBanner();
  return true;
}

/** 記録の総件数（バックアップが必要かの判定に使う） */
function totalRecordCount() {
  return db.stores.length + db.products.length + db.sales.length + db.restocks.length;
}

// ---------- 復元ポイント（自動スナップショット） ----------

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("復元ポイントの読み込みに失敗しました", e);
    return [];
  }
}

function writeSnapshots(list) {
  // 容量が足りなければ古いものから捨てて、最低1件は残るよう試みる
  let attempt = list.slice();
  while (attempt.length > 0) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(attempt));
      return true;
    } catch (e) {
      attempt = attempt.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch (e) {
    /* これ以上できることはない */
  }
  return false;
}

/**
 * 現在のデータを復元ポイントとして保存する。
 * 本体データの保存を邪魔しないよう、失敗しても例外は投げない。
 */
function takeSnapshot(reason) {
  if (totalRecordCount() === 0) return;
  const list = loadSnapshots();
  list.unshift({
    at: Date.now(),
    reason,
    data: JSON.parse(JSON.stringify(db)),
  });
  writeSnapshots(list.slice(0, MAX_SNAPSHOTS));
}

/** 1日1回、その日の最初の変更時に自動で控えを取る */
function maybeAutoSnapshot() {
  if (totalRecordCount() === 0) return;
  const list = loadSnapshots();
  const today = todayStr();
  const hasToday = list.some((s) => s.reason === "自動（毎日）" && toDateStr(new Date(s.at)) === today);
  if (!hasToday) takeSnapshot("自動（毎日）");
}

// ---------- バックアップの記録 ----------

function loadBackupMeta() {
  const fallback = { at: null, recordCount: 0, changeCount: 0 };
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch (e) {
    return fallback;
  }
}

function markBackedUp() {
  try {
    localStorage.setItem(
      BACKUP_META_KEY,
      JSON.stringify({
        at: Date.now(),
        recordCount: totalRecordCount(),
        changeCount: changeCounter,
      })
    );
  } catch (e) {
    console.warn("バックアップ日時を記録できませんでした", e);
  }
  updateBackupBanner();
  renderSettings();
}

function daysSince(timestamp) {
  return Math.floor((Date.now() - timestamp) / 86400000);
}

/** ホーム上部のバックアップ催促を出すかどうか */
function updateBackupBanner() {
  const banner = document.getElementById("backup-banner");
  if (!banner) return;
  const meta = loadBackupMeta();
  const count = totalRecordCount();

  if (count === 0) {
    banner.hidden = true;
    return;
  }
  // 書き出したあと一度も変えていなければ催促しない
  if (meta.at && pendingChanges(meta) === 0) {
    banner.hidden = true;
    return;
  }

  const detail = document.getElementById("backup-banner-detail");
  if (!meta.at) {
    banner.hidden = false;
    detail.textContent = `まだ一度も書き出していません（${count}件の記録）`;
    return;
  }

  const days = daysSince(meta.at);
  const added = count - meta.recordCount;
  // 記録が増えているときはその件数を、そうでないときは変更があったことだけを伝える
  const changeText = added > 0 ? `${added}件ふえています` : "変更があります";

  // 日が経ったとき、あるいは短期間でも変更がたまったときに知らせる
  if (days >= BACKUP_REMINDER_DAYS) {
    banner.hidden = false;
    detail.textContent = `前回から${days}日、${changeText}`;
    return;
  }
  if (pendingChanges(meta) >= BACKUP_REMINDER_RECORDS) {
    banner.hidden = false;
    detail.textContent =
      days === 0 ? `前回の書き出しから${changeText}` : `前回から${days}日で${changeText}`;
    return;
  }
  banner.hidden = true;
}

/** 前回のバックアップ以降に保存された回数 */
function pendingChanges(meta) {
  return Math.max(0, changeCounter - (meta.changeCount || 0));
}

function findProduct(id) {
  return db.products.find((p) => p.id === id) || null;
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- 画面切り替え ----------

const SCREENS = [
  "home", "sale", "stock", "report", "history", "settings",
  "product-form", "import", "shipment", "record-edit",
];

function showScreen(name, opts = {}) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = s !== name;
  });
  const SUB_SCREEN_TABS = {
    "product-form": "stock",
    import: "sale",
    shipment: "stock",
    "record-edit": "history",
  };
  const activeTab = opts.activeTab || SUB_SCREEN_TABS[name] || name;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === activeTab);
  });
  window.scrollTo(0, 0);

  if (name === "home") renderHome();
  if (name === "sale") renderSaleScreen();
  if (name === "stock") renderStockList();
  if (name === "report") renderReport();
  if (name === "history") renderHistory();
  if (name === "settings") renderSettings();
  if (name === "shipment") renderShipment();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

// ---------- ホーム ----------

function renderHome() {
  updateBackupBanner();

  // 空のときに ¥0 だけを並べると、新規なのかデータを見失ったのか区別がつかない
  const isEmpty = totalRecordCount() === 0;
  document.getElementById("empty-state").hidden = !isEmpty;
  document.getElementById("home-main").hidden = isEmpty;
  if (isEmpty) return;

  const today = todayStr();
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  const todaySales = db.sales.filter((s) => s.date === today);
  const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  document.getElementById("home-today-total").textContent = formatYen(todayTotal);
  document.getElementById("home-today-count").textContent = `${todaySales.length}件`;

  const monthSales = db.sales.filter((s) => s.date.startsWith(monthPrefix));
  const monthTotal = monthSales.reduce((sum, s) => sum + s.total, 0);
  const monthQty = monthSales.reduce((sum, s) => sum + s.qty, 0);
  document.getElementById("home-month-total").textContent = formatYen(monthTotal);
  document.getElementById("home-month-qty").textContent = String(monthQty);

  // 在庫は多い順。残り少ないものは下に集まるので、補充の判断もここでつく
  const stockRows = stockOverview().sort((a, b) => b.total - a.total);
  document.getElementById("home-stock-badge").textContent = String(stockRows.length);
  const stockList = document.getElementById("home-stock-list");
  stockList.innerHTML = "";
  if (stockRows.length === 0) {
    stockList.innerHTML = `<div class="list-empty">まだ商品が登録されていません</div>`;
  } else {
    stockRows.forEach((row) => {
      const breakdown = row.perStore.length
        ? row.perStore.map((e) => `${e.store.name} ${e.qty}`).join("・")
        : "どの店舗にも置いていません";
      stockList.appendChild(
        buildListItem({
          title: row.product.name,
          sub: breakdown,
          value: `${row.total}点`,
          low: row.total <= 0,
          onClick: () => openProductForm(row.product.id),
        })
      );
    });
  }

  const recent = [...db.sales].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const recentList = document.getElementById("home-recent-sales");
  recentList.innerHTML = "";
  if (recent.length === 0) {
    recentList.innerHTML = `<div class="list-empty">まだ売上の記録がありません</div>`;
  } else {
    recent.forEach((s) => {
      recentList.appendChild(
        buildListItem({
          title: s.productName,
          sub: `${s.storeName || "―"}・${s.date}・${s.qty}個`,
          value: formatYen(s.total),
        })
      );
    });
  }
}

function buildListItem({ title, sub, value, low, onClick, onDelete }) {
  const row = document.createElement("div");
  row.className = "list-item" + (low ? " low-stock" : "") + (onClick ? " clickable" : "");

  const main = document.createElement("div");
  main.className = "list-item-main";
  const t = document.createElement("div");
  t.className = "list-item-title";
  t.textContent = title;
  main.appendChild(t);
  if (sub) {
    const s = document.createElement("div");
    s.className = "list-item-sub";
    s.textContent = sub;
    main.appendChild(s);
  }
  row.appendChild(main);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "6px";

  const v = document.createElement("div");
  v.className = "list-item-value";
  v.textContent = value;
  right.appendChild(v);

  if (onDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "list-item-del";
    del.textContent = "削除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete();
    });
    right.appendChild(del);
  }

  row.appendChild(right);

  if (onClick) row.addEventListener("click", onClick);
  return row;
}

// ---------- 売上入力 ----------

function renderSaleScreen() {
  const storeSelect = document.getElementById("sale-store");
  fillStoreSelect(storeSelect, storeSelect.value);

  renderSaleProductOptions();
  document.getElementById("sale-date").value = todayStr();
  document.getElementById("sale-qty").value = "1";
  document.getElementById("sale-memo").value = "";
  syncSalePriceFromProduct();
  updateSalePreview();
}

/** 選択中の店舗の在庫を添えて、商品の選択肢を作り直す */
function renderSaleProductOptions() {
  const select = document.getElementById("sale-product");
  const keep = select.value;
  const storeId = document.getElementById("sale-store").value;
  select.innerHTML = "";
  if (db.products.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "先に「出荷」タブで商品を登録してください";
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
    return;
  }
  db.products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}（在庫 ${getStock(p, storeId)}）`;
    if (p.id === keep) opt.selected = true;
    select.appendChild(opt);
  });
}

function syncSalePriceFromProduct() {
  const productId = document.getElementById("sale-product").value;
  const product = findProduct(productId);
  document.getElementById("sale-price").value = product ? product.price : "";
}

function updateSalePreview() {
  const qty = Number(document.getElementById("sale-qty").value) || 0;
  const price = Number(document.getElementById("sale-price").value) || 0;
  document.getElementById("sale-total-preview").textContent = formatYen(qty * price);

  const productId = document.getElementById("sale-product").value;
  const storeId = document.getElementById("sale-store").value;
  const product = findProduct(productId);
  const warning = document.getElementById("sale-stock-warning");
  const stock = getStock(product, storeId);
  if (product && qty > stock) {
    const store = findStore(storeId);
    warning.hidden = false;
    warning.textContent =
      `⚠ ${store ? store.name + "の" : ""}在庫（${stock}）を超えています。記録すると在庫はマイナスになります。`;
  } else {
    warning.hidden = true;
  }
}

document.getElementById("sale-store").addEventListener("change", () => {
  renderSaleProductOptions();
  updateSalePreview();
});

document.getElementById("sale-product").addEventListener("change", () => {
  syncSalePriceFromProduct();
  updateSalePreview();
});
document.getElementById("sale-qty").addEventListener("input", updateSalePreview);
document.getElementById("sale-price").addEventListener("input", updateSalePreview);

document.getElementById("sale-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const productId = document.getElementById("sale-product").value;
  const product = findProduct(productId);
  const store = findStore(document.getElementById("sale-store").value);
  if (!store) {
    showToast("店舗を選択してください");
    return;
  }
  if (!product) {
    showToast("商品を選択してください");
    return;
  }
  const qty = Number(document.getElementById("sale-qty").value);
  const unitPrice = Number(document.getElementById("sale-price").value);
  const date = document.getElementById("sale-date").value || todayStr();
  const memo = document.getElementById("sale-memo").value.trim();

  if (!qty || qty <= 0) {
    showToast("数量を正しく入力してください");
    return;
  }
  if (unitPrice < 0 || Number.isNaN(unitPrice)) {
    showToast("単価を正しく入力してください");
    return;
  }
  const stock = getStock(product, store.id);
  if (qty > stock) {
    if (!confirm(`${store.name}の在庫（${stock}）を超えています。このまま記録しますか？`)) return;
  }

  db.sales.push({
    id: uid(),
    storeId: store.id,
    storeName: store.name,
    productId: product.id,
    productName: product.name,
    qty,
    unitPrice,
    total: qty * unitPrice,
    date,
    memo,
    createdAt: Date.now(),
  });
  addStock(product, store.id, -qty);
  saveDB();
  showToast("売上を記録しました。続けて入力できます");

  // 同じ店舗・日付のまま次を入力できるよう、数量とメモだけ戻す
  document.getElementById("sale-qty").value = "1";
  document.getElementById("sale-memo").value = "";
  renderSaleProductOptions();
  syncSalePriceFromProduct();
  updateSalePreview();
});

// ---------- 在庫・商品管理 ----------

/** 在庫画面で選択中の店舗。空文字なら全店合計 */
let stockStoreFilter = "";

function renderStockList() {
  renderStockStoreChips();

  const filterStore = stockStoreFilter ? findStore(stockStoreFilter) : null;
  document.getElementById("btn-zero-stock").textContent = filterStore
    ? `${filterStore.name}の在庫をすべて0にする`
    : "在庫をすべて0にする";

  const list = document.getElementById("product-list");
  list.innerHTML = "";
  if (db.products.length === 0) {
    list.innerHTML = `<div class="list-empty">まだ商品が登録されていません。「＋ 商品追加」から登録してください</div>`;
    return;
  }

  const store = stockStoreFilter ? findStore(stockStoreFilter) : null;

  [...db.products]
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .forEach((p) => {
      const qty = store ? getStock(p, store.id) : totalStock(p);
      // 全店表示では、その商品を扱っている店舗数を添える
      const storeCount = p.stockByStore ? Object.keys(p.stockByStore).length : 0;
      const sub = store
        ? (p.category ? `${p.category}・` : "") + formatYen(p.price)
        : (p.category ? `${p.category}・` : "") + `${formatYen(p.price)}・${storeCount}店舗`;
      list.appendChild(
        buildListItem({
          title: p.name,
          sub,
          value: store ? `在庫 ${qty}` : `合計 ${qty}`,
          low: store ? qty <= 0 : false,
          onClick: () => openProductForm(p.id),
        })
      );
    });
}

/**
 * 在庫をまとめて0にする。表示中の店舗だけが対象なので、
 * ボタンの文言も「どこを0にするのか」に合わせて変える。
 */
document.getElementById("btn-zero-stock").addEventListener("click", () => {
  const store = stockStoreFilter ? findStore(stockStoreFilter) : null;
  const target = store ? store.name : "すべての店舗";

  // 0でない在庫だけ数える。何件が動くのかを見てから決められるように
  let affected = 0;
  db.products.forEach((p) => {
    Object.keys(p.stockByStore || {}).forEach((storeId) => {
      if (store && storeId !== store.id) return;
      if (getStock(p, storeId) !== 0) affected += 1;
    });
  });

  if (affected === 0) {
    showToast("0にする在庫がありません");
    return;
  }

  const message =
    `${target}の在庫を、ほんとうにすべて0にしますか？\n\n` +
    `${affected}件の在庫が0になります。\n` +
    `売上と出荷の記録は残ります。\n\n` +
    `実行の直前の状態は復元ポイントに保存されるので、あとから戻せます。`;
  if (!confirm(message)) return;

  takeSnapshot(store ? `${store.name}の在庫を0にする直前` : "在庫を0にする直前");

  db.products.forEach((p) => {
    Object.keys(p.stockByStore || {}).forEach((storeId) => {
      if (store && storeId !== store.id) return;
      p.stockByStore[storeId] = 0;
    });
  });

  saveDB();
  showToast(`${target}の在庫を0にしました`);
  renderStockList();
});

function renderStockStoreChips() {
  const row = document.getElementById("stock-store-chips");
  row.innerHTML = "";
  if (db.stores.length === 0) {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  const makeChip = (id, label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (stockStoreFilter === id ? " active" : "");
    chip.textContent = label;
    chip.addEventListener("click", () => {
      stockStoreFilter = id;
      renderStockList();
    });
    row.appendChild(chip);
  };

  makeChip("", "全店");
  db.stores.forEach((s) => makeChip(s.id, s.name));
}

document.getElementById("btn-new-product").addEventListener("click", () => openProductForm(null));

function openProductForm(id) {
  const product = id ? findProduct(id) : null;
  document.getElementById("product-form-title").textContent = product ? "商品を編集" : "商品を追加";
  document.getElementById("product-id").value = product ? product.id : "";
  document.getElementById("product-name").value = product ? product.name : "";
  document.getElementById("product-category").value = product ? product.category || "" : "";
  document.getElementById("product-aliases").value =
    product && Array.isArray(product.aliases) ? product.aliases.join("、") : "";
  document.getElementById("product-price").value = product ? product.price : "";
  document.getElementById("btn-product-delete").hidden = !product;
  renderProductStockRows(product);

  const restockForm = document.getElementById("restock-form");
  restockForm.closest(".card").style.display = product ? "" : "none";
  if (product) {
    fillStoreSelect(document.getElementById("restock-store"), stockStoreFilter);
    document.getElementById("restock-date").value = todayStr();
    document.getElementById("restock-qty").value = "";
    document.getElementById("restock-memo").value = "";
    document.getElementById("restock-type").value = "in";
    updateRestockLabel();
  }

  showScreen("product-form", { activeTab: "stock" });
}

/** 商品フォームの「店舗ごとの在庫数」欄を作る */
function renderProductStockRows(product) {
  const container = document.getElementById("product-stock-rows");
  container.innerHTML = "";
  if (db.stores.length === 0) {
    container.innerHTML =
      `<div class="stock-rows-empty">店舗が未登録です。「設定」タブの「店舗の管理」から追加してください。</div>`;
    return;
  }
  db.stores.forEach((store) => {
    const row = document.createElement("div");
    row.className = "stock-row";

    const name = document.createElement("div");
    name.className = "stock-row-name";
    name.textContent = store.name;
    row.appendChild(name);

    const input = document.createElement("input");
    input.type = "number";
    input.step = "1";
    input.dataset.storeId = store.id;
    input.value = String(product ? getStock(product, store.id) : 0);
    row.appendChild(input);

    container.appendChild(row);
  });
}

document.getElementById("btn-product-cancel").addEventListener("click", () => showScreen("stock"));

document.getElementById("product-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("product-id").value;
  const name = document.getElementById("product-name").value.trim();
  const category = document.getElementById("product-category").value.trim();
  const aliases = parseAliasInput(document.getElementById("product-aliases").value);
  const price = Number(document.getElementById("product-price").value);

  if (!name) {
    showToast("商品名を入力してください");
    return;
  }
  if (price < 0 || Number.isNaN(price)) {
    showToast("価格を正しく入力してください");
    return;
  }

  // 空欄の店舗は「その店では扱わない」という意味なので、在庫を持たせない
  const stockByStore = {};
  let badStock = false;
  document.querySelectorAll("#product-stock-rows input").forEach((input) => {
    const raw = input.value.trim();
    if (raw === "") return;
    const qty = Number(raw);
    if (Number.isNaN(qty)) { badStock = true; return; }
    stockByStore[input.dataset.storeId] = qty;
  });
  if (badStock) {
    showToast("在庫数を正しく入力してください");
    return;
  }

  const product = id ? findProduct(id) : null;
  if (product) {
    product.name = name;
    product.category = category;
    product.aliases = aliases;
    product.price = price;
    product.stockByStore = stockByStore;
  } else {
    db.products.push({
      id: uid(),
      name,
      category,
      aliases,
      price,
      stockByStore,
      createdAt: Date.now(),
    });
  }
  saveDB();
  showToast("商品を保存しました");
  showScreen("stock");
});

document.getElementById("btn-product-delete").addEventListener("click", () => {
  const id = document.getElementById("product-id").value;
  const product = findProduct(id);
  if (!product) return;
  if (!confirm(`「${product.name}」を削除しますか？過去の売上履歴は残ります。`)) return;
  db.products = db.products.filter((p) => p.id !== id);
  saveDB();
  showToast("商品を削除しました");
  showScreen("stock");
});

document.getElementById("restock-type").addEventListener("change", updateRestockLabel);
function updateRestockLabel() {
  const type = document.getElementById("restock-type").value;
  document.getElementById("restock-qty-label").textContent =
    type === "adjust" ? "実際の在庫数" : "入荷数量";
}

document.getElementById("restock-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("product-id").value;
  const product = findProduct(id);
  if (!product) return;
  const store = findStore(document.getElementById("restock-store").value);
  if (!store) {
    showToast("店舗を選択してください");
    return;
  }

  const type = document.getElementById("restock-type").value;
  const qty = Number(document.getElementById("restock-qty").value);
  const date = document.getElementById("restock-date").value || todayStr();
  const memo = document.getElementById("restock-memo").value.trim();

  if (Number.isNaN(qty) || qty < 0) {
    showToast("数量を正しく入力してください");
    return;
  }

  if (type === "in") {
    addStock(product, store.id, qty);
  } else {
    setStock(product, store.id, qty);
  }

  db.restocks.push({
    id: uid(),
    storeId: store.id,
    storeName: store.name,
    productId: product.id,
    productName: product.name,
    type,
    qty,
    date,
    memo,
    createdAt: Date.now(),
  });

  saveDB();
  renderProductStockRows(product);
  document.getElementById("restock-qty").value = "";
  document.getElementById("restock-memo").value = "";
  showToast(type === "in" ? "入荷を記録しました" : "棚卸しを記録しました");
});

// ---------- チャット・スクショからの取込 ----------
//
// 画像の文字認識は端末（iOSの「テキスト認識表示」など）の機能で行ってもらい、
// このアプリは貼り付けられたテキストを解析するだけ。よって画像もテキストも
// 外部には一切送信されない。

/**
 * 表記ゆれをそろえる。NFKC が全角数字・全角英字・半角カタカナをまとめて
 * 直してくれるので、読み取り結果の細かな違いはここで吸収される。
 */
function normalizeText(str) {
  return String(str).normalize("NFKC").replace(/　/g, " ");
}

/**
 * 名前の照合用キー。カタカナはひらがなに寄せ、記号・空白・長音を落とす。
 * 「キュウリ」「きゅうり」「キューリ」「きゅ うり」がすべて同じ鍵になる。
 */
function matchKey(str) {
  return normalizeText(str)
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/[\s・･,，、.。'"’”「」『』()（）\[\]【】\-‐－—ー~〜:：;；!！?？]/g, "");
}

/** 商品の呼び名すべて（登録名＋別名） */
function productNames(product) {
  return [product.name, ...(Array.isArray(product.aliases) ? product.aliases : [])];
}

function parseAliasInput(text) {
  return String(text)
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 行から日付を取り出す。見つからなければ null */
function extractDate(line) {
  let m = line.match(/(\d{4})\s*[/\-年]\s*(\d{1,2})\s*[/\-月]\s*(\d{1,2})\s*日?/);
  if (m) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[1]}-${pad2(mo)}-${pad2(d)}`;
  }
  m = line.match(/(?:^|[^\d/\-:])(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?(?![\d/:])/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${new Date().getFullYear()}-${pad2(mo)}-${pad2(d)}`;
    }
  }
  return null;
}

/** カタカナをひらがなへ寄せ、長音を落とす。単位の表記ゆれを吸収するため */
function kanaFold(str) {
  return str
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/ー/g, "");
}

// kanaFold を通した後の形で書く。「本」「ほん」「ホン」がすべて拾えるよう、
// 漢字とひらがなの両方を並べている。
const QTY_UNITS = [
  "個", "こ", "点", "本", "ほん", "袋", "ふくろ", "ぱっく", "枚", "まい",
  "箱", "はこ", "束", "たば", "把", "わ", "玉", "たま", "株", "かぶ",
  "杯", "はい", "皿", "さら", "人前", "にんまえ", "せっと", "けす", "ねっと",
  "kg", "pcs", "pc",
].join("|");

/**
 * 数量を探す前に、数量ではありえない数字を消しておく。
 * 「きゅうり 486円」の 486 や、日付・時刻を数量と読み違えないようにするため。
 */
function stripNonQtyNumbers(line) {
  return line
    .replace(/[¥￥]\s*\d[\d,]*/g, " ")
    .replace(/\d[\d,]*\s*円/g, " ")
    .replace(/(@|単価)\s*\d[\d,]*/g, " ")
    .replace(/\d{4}\s*[/年]\s*\d{1,2}\s*[/月]\s*\d{1,2}\s*日?/g, " ")
    .replace(/\d{1,2}\s*[/月]\s*\d{1,2}\s*日?/g, " ")
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, " ");
}

/** 行から数量を取り出す。見つからなければ null */
function extractQty(line) {
  const cleaned = kanaFold(stripNonQtyNumbers(line));

  let m = cleaned.match(new RegExp(`(\\d+)\\s*(?:${QTY_UNITS})`, "i"));
  if (m) return Number(m[1]);
  m = cleaned.match(/[×x*]\s*(\d+)/i);
  if (m) return Number(m[1]);
  m = cleaned.match(/(\d+)\s*[×x*]/i);
  if (m) return Number(m[1]);
  // 単位のない裸の数字（「きゅうり 3」）。金額や日付は上で消してある。
  m = cleaned.match(/(?:^|\s)(\d{1,3})(?=\s|$)/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * 「合計」「小計」など、明細ではなく集計を書いた行。
 * 行頭に限るのは、「本日のきゅうり」のような普通の行を巻き込まないため。
 */
function isSummaryLine(line) {
  return /^\s*(合計|小計|総計|売上計|計)/.test(line);
}

/**
 * 数字と単位だけでできた行（「216円」「6点 1,296円」）。
 * 確定売上のお知らせのように、品名と数量が別の行に分かれる形式で、
 * どの行を直前の品名の続きとみなすかの判定に使う。
 * 文字が少しでも残る行は続きとみなさないので、雑談を巻き込まない。
 */
function isNumericDetailLine(line) {
  const rest = kanaFold(normalizeText(line))
    .replace(new RegExp(`\\d[\\d,]*\\s*(?:${QTY_UNITS})`, "gi"), "")
    .replace(/[\d,]/g, "")
    .replace(/[¥￥円@×x*\s:：・\-‐－—~〜()（）]/gi, "")
    .replace(/単価|数量|金額|点数/g, "");
  return rest === "" && /\d/.test(line);
}

/**
 * 文章に書かれている内容から単価を読む。
 * hintUnitPrice は「単価だけが別の行に書かれていた」ときの値。
 */
function unitPriceFromText(product, qty, prices, hintUnitPrice) {
  const explicit = prices.find((p) => p.isUnit);
  if (explicit) return explicit.value;

  const values = prices.map((p) => p.value);
  const hasHint = hintUnitPrice !== null && hintUnitPrice !== undefined;

  // 別行の単価 × 数量 が合計と一致すれば、その単価で確定できる
  if (hasHint && values.some((v) => v === hintUnitPrice * qty)) return hintUnitPrice;

  if (values.length >= 2) return Math.min(values[0], values[1]);
  if (values.length === 1) {
    const price = values[0];
    if (qty === 1) return price; // 1点なら金額がそのまま単価
    if (price % qty === 0) return price / qty;
    // 割り切れない＝その日の中で値段の違うものが混ざっている。
    // 金額を数量で割ると半端な単価になるので、書かれている単価を使う。
    // 実際の金額は total として別に持つので、売上額はずれない。
    if (hasHint) return hintUnitPrice;
    if (product && Number(product.price) > 0) return Number(product.price);
    return price / qty;
  }
  if (hasHint) return hintUnitPrice;
  return product ? product.price : 0;
}

/**
 * 文章に書かれている合計金額。単価として明示された金額は除く。
 * 「2点 421円」のように単価×数量で表せない金額を、そのまま残すために使う。
 */
function totalFromText(prices) {
  const values = prices.filter((p) => !p.isUnit).map((p) => p.value);
  return values.length ? Math.max(...values) : null;
}

/**
 * 取込に使う単価。文章に書かれている金額をそのまま採る。
 * 価格は日によって変わるので、商品に登録した単価で上書きしてはいけない。
 * 登録単価が使われるのは、文章から金額が読めなかったときだけ
 * （unitPriceFromText の最後の行）。
 *
 * ただし読み取りを誤ると金額がそのまま記録に残ってしまうので、
 * 桁を読み違えたとしか思えないほど離れているときだけ警告用に控えておく。
 * 値引きは半額を割ることもあるので、5倍を境にする。216円が16円と読めれば
 * 13.5倍になって引っかかるが、値引きでそこまで開くことはない。
 */
const PRICE_WARNING_RATIO = 5;

function resolveUnitPrice(product, qty, prices, hintUnitPrice) {
  const unitPrice = unitPriceFromText(product, qty, prices, hintUnitPrice);
  const registered = product ? Number(product.price) : 0;
  const farOff =
    registered > 0 &&
    unitPrice > 0 &&
    (unitPrice >= registered * PRICE_WARNING_RATIO ||
      unitPrice * PRICE_WARNING_RATIO <= registered);
  return { unitPrice, registeredPrice: farOff ? registered : null };
}

/** 行から金額を取り出す。[{ value, isUnit }] の配列を返す */
function extractPrices(line) {
  const found = [];
  const re = /(@|単価)?\s*(?:[¥￥]\s*(\d[\d,]*)|(\d[\d,]*)\s*円)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const value = Number((m[2] || m[3]).replace(/,/g, ""));
    if (!Number.isNaN(value)) found.push({ value, isUnit: Boolean(m[1]) });
  }
  return found;
}

/**
 * 行に含まれる登録済みの名前を探す。別名も含めて一番長く一致したものを採る。
 * 「ミニトマト」は「トマト」も含むので、長いほうを優先しないと取り違える。
 */
function findByNameInLine(line, list, namesOf) {
  const key = matchKey(line);
  let best = null;
  let bestLength = 0;
  list.forEach((item) => {
    namesOf(item).forEach((name) => {
      const nameKey = matchKey(name);
      if (nameKey && key.includes(nameKey) && nameKey.length > bestLength) {
        best = item;
        bestLength = nameKey.length;
      }
    });
  });
  return best;
}

function findProductInLine(line) {
  return findByNameInLine(line, db.products, productNames);
}

function findStoreInLine(line) {
  return findByNameInLine(line, db.stores, (s) => [s.name]);
}

/** 売上候補を1件つくる */
function buildRow({ source, storeId, product, qty, prices, hintUnitPrice, date }) {
  const finalQty = qty !== null && qty > 0 ? qty : 1;
  const resolved = resolveUnitPrice(product, finalQty, prices, hintUnitPrice);
  const unitPrice = Number.isFinite(resolved.unitPrice) ? resolved.unitPrice : 0;

  // 文章に合計が書かれていればそれが実際の売上額。単価×数量では表せない
  // 金額（値段の違うものが混ざった日）を、そのまま記録するため。
  const stated = totalFromText(prices);
  const total = stated !== null ? stated : finalQty * unitPrice;

  return {
    id: uid(),
    source,
    storeId: storeId || "",
    productId: product ? product.id : "",
    qty: finalQty,
    unitPrice,
    total,
    // 読み取り違いが疑われるときだけ入る。通常は null
    registeredPrice: resolved.registeredPrice,
    date,
    include: Boolean(product && storeId),
  };
}

/**
 * 貼り付けられた文章を売上候補に変換する。
 *
 * 1行に品名・数量・金額がそろう形式と、確定売上のお知らせのように
 *
 *     なす
 *     　 216円
 *     　　　6点 1,296円
 *
 * と3行に分かれる形式の両方を読む。後者は品名の行をいったん保留し、
 * 続く「数字だけの行」を吸収してから1件にまとめる。
 */
function parseChatText(text, defaultStoreId) {
  const lines = normalizeText(text).split(/\r?\n/);
  const rows = [];
  let contextDate = todayStr();
  let contextStoreId = defaultStoreId || "";
  let pending = null; // { product, storeId, unitPrice, sources }

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (isSummaryLine(line)) {
      pending = null;
      return;
    }

    const dateFound = extractDate(line);
    if (dateFound) contextDate = dateFound;
    const storeFound = findStoreInLine(line);
    if (storeFound) contextStoreId = storeFound.id;

    const product = findProductInLine(line);
    const qty = extractQty(line);
    const prices = extractPrices(line);

    // 数字だけの行は、直前に保留した品名の続きとして扱う
    if (!product && isNumericDetailLine(line)) {
      if (!pending) return; // 結びつく品名がなければ、集計行などとみなして捨てる
      pending.sources.push(line);
      if (qty === null) {
        if (prices.length) pending.unitPrice = prices[0].value; // 単価だけの行
        return;
      }
      rows.push(
        buildRow({
          source: pending.sources.join("　"),
          storeId: pending.storeId,
          product: pending.product,
          qty,
          prices,
          hintUnitPrice: pending.unitPrice,
          date: contextDate,
        })
      );
      pending = null;
      return;
    }

    // 品名だけの行 → 続きの明細を待つ
    if (product && qty === null && prices.length === 0) {
      pending = { product, storeId: contextStoreId, unitPrice: null, sources: [line] };
      return;
    }

    pending = null;

    // 1行で完結する形式。商品も、数量と金額の組もない行は売上ではない
    if (!product && !(qty !== null && prices.length > 0)) return;

    rows.push(
      buildRow({
        source: line,
        storeId: storeFound ? storeFound.id : contextStoreId,
        product,
        qty,
        prices,
        hintUnitPrice: null,
        date: contextDate,
      })
    );
  });

  return rows;
}

/** @type {Array} 取込プレビューの現在の内容 */
let importRows = [];

document.getElementById("btn-open-import").addEventListener("click", () => {
  document.getElementById("import-text").value = "";
  document.getElementById("import-result-card").hidden = true;
  fillStoreSelect(document.getElementById("import-default-store"), "");
  importRows = [];
  showScreen("import");
});

document.getElementById("btn-import-back").addEventListener("click", () => showScreen("sale"));

document.getElementById("btn-import-parse").addEventListener("click", () => {
  const text = document.getElementById("import-text").value;
  if (!text.trim()) {
    showToast("文章を貼り付けてください");
    return;
  }
  if (db.products.length === 0) {
    showToast("先に「出荷」タブで商品を登録してください");
    return;
  }
  if (db.stores.length === 0) {
    showToast("先に「設定」タブで店舗を登録してください");
    return;
  }
  importRows = parseChatText(text, document.getElementById("import-default-store").value);
  if (importRows.length === 0) {
    document.getElementById("import-result-card").hidden = true;
    showToast("売上らしい行が見つかりませんでした");
    return;
  }
  document.getElementById("import-result-card").hidden = false;
  renderImportRows();
  showToast(`${importRows.length}件の候補が見つかりました`);
});

function renderImportRows() {
  const container = document.getElementById("import-rows");
  container.innerHTML = "";

  importRows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "import-row" + (row.productId && row.storeId ? "" : " unmatched");

    const head = document.createElement("div");
    head.className = "import-row-head";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = row.include;
    check.addEventListener("change", () => {
      row.include = check.checked;
      updateImportTotal();
    });
    head.appendChild(check);

    const src = document.createElement("div");
    src.className = "import-src";
    src.textContent = row.source;
    head.appendChild(src);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "import-del";
    del.textContent = "除外";
    del.addEventListener("click", () => {
      importRows = importRows.filter((r) => r.id !== row.id);
      renderImportRows();
    });
    head.appendChild(del);

    el.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "import-grid";

    // 店舗
    const storeField = document.createElement("label");
    storeField.className = "field field-wide";
    storeField.innerHTML = "<span>店舗</span>";
    const storeSelect = document.createElement("select");
    const storeBlank = document.createElement("option");
    storeBlank.value = "";
    storeBlank.textContent = "（店舗をえらぶ）";
    storeSelect.appendChild(storeBlank);
    db.stores.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === row.storeId) opt.selected = true;
      storeSelect.appendChild(opt);
    });
    storeSelect.addEventListener("change", () => {
      row.storeId = storeSelect.value;
      renderImportRows();
    });
    storeField.appendChild(storeSelect);
    grid.appendChild(storeField);

    // 商品
    const productField = document.createElement("label");
    productField.className = "field field-wide";
    productField.innerHTML = "<span>商品</span>";
    const select = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "（商品をえらぶ）";
    select.appendChild(blank);
    db.products.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === row.productId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      row.productId = select.value;
      const product = findProduct(select.value);
      if (product && !row.unitPriceEdited) {
        row.unitPrice = product.price;
      }
      renderImportRows();
      updateImportTotal();
    });
    productField.appendChild(select);
    grid.appendChild(productField);

    // 数量
    const qtyField = document.createElement("label");
    qtyField.className = "field";
    qtyField.innerHTML = "<span>数量</span>";
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.step = "1";
    qtyInput.value = String(row.qty);
    qtyInput.addEventListener("input", () => {
      row.qty = Number(qtyInput.value) || 0;
      recalcRowTotal(row);
      updateRowTotal(el, row);
      updateImportTotal();
    });
    qtyField.appendChild(qtyInput);
    grid.appendChild(qtyField);

    // 単価
    const priceField = document.createElement("label");
    priceField.className = "field";
    priceField.innerHTML = "<span>単価（円）</span>";
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.step = "1";
    priceInput.value = String(row.unitPrice);
    priceInput.addEventListener("input", () => {
      row.unitPrice = Number(priceInput.value) || 0;
      row.unitPriceEdited = true;
      recalcRowTotal(row);
      updateRowTotal(el, row);
      updateImportTotal();
    });
    priceField.appendChild(priceInput);

    // 金額がかけ離れているときだけ、読み取り違いを疑って知らせる
    if (row.registeredPrice) {
      const swap = document.createElement("button");
      swap.type = "button";
      swap.className = "price-hint";
      swap.textContent = `登録は${formatYen(row.registeredPrice)}。読み違いなら押す`;
      swap.addEventListener("click", () => {
        row.unitPrice = row.registeredPrice;
        row.unitPriceEdited = true;
        row.registeredPrice = null;
        recalcRowTotal(row);
        renderImportRows();
      });
      priceField.appendChild(swap);
    }

    grid.appendChild(priceField);

    // 日付
    const dateField = document.createElement("label");
    dateField.className = "field field-wide";
    dateField.innerHTML = "<span>日付</span>";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = row.date;
    dateInput.addEventListener("change", () => {
      row.date = dateInput.value || todayStr();
    });
    dateField.appendChild(dateInput);
    grid.appendChild(dateField);

    el.appendChild(grid);

    const total = document.createElement("div");
    total.className = "import-row-total";
    el.appendChild(total);

    container.appendChild(el);
    updateRowTotal(el, row);
  });

  updateImportTotal();
}

function updateRowTotal(el, row) {
  const totalEl = el.querySelector(".import-row-total");
  if (!totalEl) return;
  totalEl.textContent = `小計 ${formatYen(row.total)}`;

  // 単価×数量と合わない分（値段の違うものが混ざった日）を添える
  const diff = row.total - row.qty * row.unitPrice;
  const noteEl = el.querySelector(".import-row-diff");
  if (noteEl) noteEl.remove();
  if (diff !== 0) {
    const note = document.createElement("div");
    note.className = "import-row-diff";
    note.textContent =
      diff < 0
        ? `値引き -${formatYen(Math.abs(diff))}`
        : `割増 +${formatYen(diff)}`;
    totalEl.insertAdjacentElement("afterend", note);
  }
}

/** 数量や単価を直したときは、合計もそれに合わせ直す */
function recalcRowTotal(row) {
  row.total = row.qty * row.unitPrice;
}

function updateImportTotal() {
  const selected = importRows.filter((r) => r.include && r.productId && r.storeId);
  const total = selected.reduce((sum, r) => sum + r.total, 0);
  document.getElementById("import-total").textContent = formatYen(total);
  document.getElementById("import-count").textContent = String(selected.length);
}

document.getElementById("btn-import-commit").addEventListener("click", () => {
  const selected = importRows.filter((r) => r.include && r.productId && r.storeId && r.qty > 0);
  if (selected.length === 0) {
    showToast("登録する行がありません");
    return;
  }

  const skipped = importRows.filter((r) => r.include && (!r.productId || !r.storeId)).length;
  let message = `${selected.length}件の売上を登録します。よろしいですか？`;
  if (skipped > 0) message += `\n（店舗または商品が未選択の${skipped}件はスキップされます）`;
  if (!confirm(message)) return;

  selected.forEach((row) => {
    const product = findProduct(row.productId);
    const store = findStore(row.storeId);
    if (!product || !store) return;
    db.sales.push({
      id: uid(),
      storeId: store.id,
      storeName: store.name,
      productId: product.id,
      productName: product.name,
      qty: row.qty,
      unitPrice: row.unitPrice,
      total: row.total,
      date: row.date,
      memo: "チャットから取込",
      createdAt: Date.now(),
    });
    addStock(product, store.id, -row.qty);
  });

  saveDB();
  importRows = [];
  // 店舗ごとにお知らせが届くので、登録したらそのまま次を貼れるようにしておく
  const textarea = document.getElementById("import-text");
  textarea.value = "";
  document.getElementById("import-result-card").hidden = true;
  showToast(`${selected.length}件を登録しました。続けて貼り付けられます`);
  textarea.scrollIntoView({ block: "center" });
});

// ---------- 出荷 ----------
//
// 出荷は「ひとつの商品を何店舗かへ配る」という動きなので、
// 商品を選んでから店舗ごとの数量をまとめて入れる形にしている。

/** 選択中の商品と、店舗ごとの出荷数 */
let shipmentProductId = "";
let shipmentQty = {};

/** 数量の選択肢。実際の出荷は5〜20点が多いので、そこを押しやすくしている */
const SHIP_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 18, 20, 24, 30];

/** 最近出荷したものを先に並べる */
function productsByRecentShipment() {
  const lastShipped = new Map();
  db.restocks.forEach((r) => {
    if (r.type !== "in") return;
    if ((lastShipped.get(r.productId) || 0) < r.createdAt) {
      lastShipped.set(r.productId, r.createdAt);
    }
  });
  return [...db.products].sort((a, b) => {
    const la = lastShipped.get(a.id) || 0;
    const lb = lastShipped.get(b.id) || 0;
    if (la !== lb) return lb - la;
    return a.name.localeCompare(b.name, "ja");
  });
}

document.getElementById("btn-open-shipment").addEventListener("click", () => {
  if (db.products.length === 0) {
    showToast("先に商品を登録してください");
    return;
  }
  if (db.stores.length === 0) {
    showToast("先に「設定」タブで店舗を登録してください");
    return;
  }
  shipmentProductId = "";
  shipmentQty = {};
  showScreen("shipment");
});

document.getElementById("btn-shipment-back").addEventListener("click", () => showScreen("stock"));
document.getElementById("btn-shipment-change").addEventListener("click", () => {
  shipmentProductId = "";
  shipmentQty = {};
  renderShipment();
});

function renderShipment() {
  const picking = !shipmentProductId;
  document.getElementById("shipment-pick-card").hidden = !picking;
  document.getElementById("shipment-qty-card").hidden = picking;
  if (picking) renderShipmentProducts();
  else renderShipmentStores();
}

function renderShipmentProducts() {
  const list = document.getElementById("shipment-product-list");
  list.innerHTML = "";

  const lastShipped = new Map();
  db.restocks.forEach((r) => {
    if (r.type !== "in") return;
    if ((lastShipped.get(r.productId) || 0) < r.createdAt) {
      lastShipped.set(r.productId, r.createdAt);
    }
  });

  productsByRecentShipment().forEach((product) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ship-product";

    const name = document.createElement("div");
    name.className = "ship-product-name";
    name.textContent = product.name;
    button.appendChild(name);

    const sub = document.createElement("div");
    sub.className = "ship-product-sub";
    const at = lastShipped.get(product.id);
    sub.textContent = at
      ? `前回 ${toDateStr(new Date(at))}・在庫 ${totalStock(product)}`
      : `出荷なし・在庫 ${totalStock(product)}`;
    button.appendChild(sub);

    button.addEventListener("click", () => {
      shipmentProductId = product.id;
      shipmentQty = {};
      document.getElementById("shipment-date").value = todayStr();
      renderShipment();
    });

    list.appendChild(button);
  });
}

function renderShipmentStores() {
  const product = findProduct(shipmentProductId);
  if (!product) {
    shipmentProductId = "";
    renderShipment();
    return;
  }
  document.getElementById("shipment-product-name").textContent = product.name;

  const container = document.getElementById("shipment-store-rows");
  container.innerHTML = "";
  db.stores.forEach((store) => container.appendChild(buildShipmentStoreRow(store)));
  updateShipmentTotal();
}

/**
 * 店舗1行分。数字を選んだときは作り直さずその場で塗り替える。
 * 作り直すと横スクロールが先頭に戻り、いま選んだ数字が画面の外へ消えてしまう。
 */
function buildShipmentStoreRow(store) {
  const qty = Number(shipmentQty[store.id]) || 0;

  const row = document.createElement("div");
  row.className = "ship-store" + (qty > 0 ? " has-qty" : "");

  const head = document.createElement("div");
  head.className = "ship-store-head";
  const name = document.createElement("span");
  name.className = "ship-store-name";
  name.textContent = store.name;
  head.appendChild(name);
  const qtyLabel = document.createElement("span");
  qtyLabel.className = "ship-store-qty" + (qty > 0 ? "" : " zero");
  qtyLabel.textContent = qty > 0 ? `${qty}点` : "なし";
  head.appendChild(qtyLabel);
  row.appendChild(head);

  const chips = document.createElement("div");
  chips.className = "ship-chips";

  // 一覧にない数量を選んだあとも、その数字を押せる位置に残す
  const choices = qty > 0 && !SHIP_CHOICES.includes(qty)
    ? [...SHIP_CHOICES, qty].sort((a, b) => a - b)
    : SHIP_CHOICES;

  const select = (value) => {
    shipmentQty[store.id] = value;
    chips.querySelectorAll(".ship-chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.value === String(value));
    });
    row.classList.toggle("has-qty", value > 0);
    qtyLabel.textContent = value > 0 ? `${value}点` : "なし";
    qtyLabel.classList.toggle("zero", value === 0);
    updateShipmentTotal();
  };

  choices.forEach((value) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ship-chip" + (value === qty ? " active" : "");
    chip.dataset.value = String(value);
    chip.textContent = String(value);
    chip.addEventListener("click", () => select(value));
    chips.appendChild(chip);
  });

  const more = document.createElement("button");
  more.type = "button";
  more.className = "ship-chip more";
  more.textContent = "その他";
  more.addEventListener("click", () => {
    const input = prompt(`${store.name} の出荷数`, String(Number(shipmentQty[store.id]) || 0));
    if (input === null) return;
    const value = Math.floor(Number(String(input).trim()));
    if (!Number.isFinite(value) || value < 0) {
      showToast("数量を正しく入力してください");
      return;
    }
    shipmentQty[store.id] = value;
    // 選択肢が増えるのでこの行だけ作り直す
    row.replaceWith(buildShipmentStoreRow(store));
    updateShipmentTotal();
  });
  chips.appendChild(more);

  row.appendChild(chips);

  // 選択済みの数字が画面の外にあると、入れたのかどうか分からなくなる
  if (qty > 0) {
    requestAnimationFrame(() => {
      const active = chips.querySelector(".ship-chip.active");
      if (active) chips.scrollLeft = active.offsetLeft - chips.clientWidth / 2 + active.offsetWidth / 2;
    });
  }

  return row;
}

function updateShipmentTotal() {
  const total = db.stores.reduce((sum, s) => sum + (Number(shipmentQty[s.id]) || 0), 0);
  document.getElementById("shipment-total").textContent = `${total}点`;
}

document.getElementById("btn-shipment-commit").addEventListener("click", () => {
  const product = findProduct(shipmentProductId);
  if (!product) return;

  const date = document.getElementById("shipment-date").value || todayStr();
  const entries = db.stores
    .map((store) => ({ store, qty: Number(shipmentQty[store.id]) || 0 }))
    .filter((e) => e.qty > 0);

  if (entries.length === 0) {
    showToast("出荷する数量を選んでください");
    return;
  }

  const summary = entries.map((e) => `${e.store.name} ${e.qty}点`).join("\n");
  if (!confirm(`${product.name} を出荷します。\n\n${summary}\n\nよろしいですか？`)) return;

  const now = Date.now();
  entries.forEach((entry, i) => {
    db.restocks.push({
      id: uid(),
      storeId: entry.store.id,
      storeName: entry.store.name,
      productId: product.id,
      productName: product.name,
      type: "in",
      qty: entry.qty,
      date,
      memo: "出荷",
      createdAt: now + i,
    });
    addStock(product, entry.store.id, entry.qty);
  });

  saveDB();
  const total = entries.reduce((sum, e) => sum + e.qty, 0);
  showToast(`${product.name} を ${entries.length}店舗・計${total}点 出荷しました`);

  // 続けて別の商品を出荷できるよう、商品選びに戻す
  shipmentProductId = "";
  shipmentQty = {};
  renderShipment();
});

// ---------- 集計 ----------

function getRangeDates(range) {
  const today = todayStr();
  if (range === "today") return { from: today, to: today };
  if (range === "all") return { from: null, to: null };

  if (range === "week") {
    const d = new Date();
    const dow = d.getDay(); // 0=Sun
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(d);
    monday.setDate(d.getDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toDateStr(monday), to: toDateStr(sunday) };
  }

  if (range === "month") {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: toDateStr(first), to: toDateStr(last) };
  }

  if (range === "custom") {
    const from = document.getElementById("report-from").value || null;
    const to = document.getElementById("report-to").value || null;
    return { from, to };
  }

  return { from: null, to: null };
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

document.querySelectorAll("#report-range-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    currentReportRange = chip.dataset.range;
    document.querySelectorAll("#report-range-chips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    document.getElementById("report-custom-range").hidden = currentReportRange !== "custom";
    if (currentReportRange === "custom") {
      const today = todayStr();
      if (!document.getElementById("report-from").value) document.getElementById("report-from").value = today;
      if (!document.getElementById("report-to").value) document.getElementById("report-to").value = today;
    }
    renderReport();
  });
});
document.getElementById("report-from").addEventListener("change", renderReport);
document.getElementById("report-to").addEventListener("change", renderReport);

function renderReportStoreChips() {
  const row = document.getElementById("report-store-chips");
  row.innerHTML = "";
  if (db.stores.length === 0) {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  const makeChip = (id, label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (reportStoreFilter === id ? " active" : "");
    chip.textContent = label;
    chip.addEventListener("click", () => {
      reportStoreFilter = id;
      renderReport();
    });
    row.appendChild(chip);
  };

  makeChip("", "全店");
  db.stores.forEach((s) => makeChip(s.id, s.name));
}

/** 集計画面で選択中の店舗。空文字なら全店 */
let reportStoreFilter = "";

function renderReport() {
  renderReportStoreChips();
  const { from, to } = getRangeDates(currentReportRange);
  const filtered = db.sales.filter((s) => {
    if (from && s.date < from) return false;
    if (to && s.date > to) return false;
    if (reportStoreFilter && s.storeId !== reportStoreFilter) return false;
    return true;
  });

  const total = filtered.reduce((sum, s) => sum + s.total, 0);
  const qty = filtered.reduce((sum, s) => sum + s.qty, 0);
  document.getElementById("report-total").textContent = formatYen(total);
  document.getElementById("report-qty").textContent = String(qty);

  const byProduct = new Map();
  filtered.forEach((s) => {
    const entry = byProduct.get(s.productId) || { name: s.productName, qty: 0, total: 0 };
    entry.qty += s.qty;
    entry.total += s.total;
    byProduct.set(s.productId, entry);
  });
  const ranking = [...byProduct.values()].sort((a, b) => b.total - a.total);
  const maxTotal = ranking.length ? ranking[0].total : 0;

  renderRanking(document.getElementById("report-ranking"), ranking, maxTotal);

  // 店舗別。店舗で絞り込んでいるあいだは1件だけになるので出さない
  const storeRankingEl = document.getElementById("report-store-ranking");
  const storeCard = storeRankingEl.closest(".card");
  if (reportStoreFilter || db.stores.length <= 1) {
    storeCard.hidden = true;
  } else {
    storeCard.hidden = false;
    const byStore = new Map();
    filtered.forEach((s) => {
      const key = s.storeId || "";
      const entry = byStore.get(key) || { name: s.storeName || "―", qty: 0, total: 0 };
      entry.qty += s.qty;
      entry.total += s.total;
      byStore.set(key, entry);
    });
    const storeRanking = [...byStore.values()].sort((a, b) => b.total - a.total);
    renderRanking(storeRankingEl, storeRanking, storeRanking.length ? storeRanking[0].total : 0);
  }

  renderSellThrough();
}

/**
 * 販売率＝出荷したもののうち売れた割合。
 *
 * 期間で絞らず、出荷を記録しはじめた日からの累計で出す。出荷より前の
 * 売上まで数えると出荷を上回ってしまい、短い期間で切ると先週出したものが
 * 今週売れた分を取りこぼすため、どちらも意味のある数字にならない。
 */
function renderSellThrough() {
  const container = document.getElementById("report-sellthrough");
  const note = document.getElementById("sellthrough-note");
  container.innerHTML = "";

  const shipments = db.restocks.filter(
    (r) => r.type === "in" && (!reportStoreFilter || r.storeId === reportStoreFilter)
  );
  if (shipments.length === 0) {
    note.textContent = "出荷の記録がないため、まだ計算できません。";
    container.innerHTML = `<div class="list-empty">出荷を記録すると表示されます</div>`;
    return;
  }

  const from = shipments.reduce((min, r) => (r.date < min ? r.date : min), shipments[0].date);
  note.textContent =
    `出荷したもののうち、どれだけ売れたかです。` +
    `出荷を記録しはじめた ${from} からの累計で計算しています。`;

  const rows = new Map();
  const entry = (product) => {
    if (!rows.has(product.id)) rows.set(product.id, { name: product.name, shipped: 0, sold: 0 });
    return rows.get(product.id);
  };

  shipments.forEach((r) => {
    const product = findProduct(r.productId);
    if (product) entry(product).shipped += r.qty;
  });
  db.sales.forEach((s) => {
    if (s.date < from) return;
    if (reportStoreFilter && s.storeId !== reportStoreFilter) return;
    const product = findProduct(s.productId);
    if (product) entry(product).sold += s.qty;
  });

  const list = [...rows.values()]
    .filter((r) => r.shipped > 0)
    .map((r) => ({ ...r, rate: r.sold / r.shipped, left: r.shipped - r.sold }))
    .sort((a, b) => b.rate - a.rate);

  if (list.length === 0) {
    container.innerHTML = `<div class="list-empty">この店舗の出荷記録がありません</div>`;
    return;
  }

  list.forEach((r) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const pct = Math.round(r.rate * 100);
    // 100%を超える分は棒からはみ出させず、数字で見せる
    const width = Math.max(4, Math.min(100, pct));
    row.innerHTML = `
      <div class="rank-row" style="width:100%">
        <div class="rank-bar-wrap">
          <div class="sellthrough-head">
            <span class="list-item-title">${escapeHtml(r.name)}</span>
            <span class="sellthrough-rate${pct >= 100 ? " full" : ""}">${pct}%</span>
          </div>
          <div class="list-item-sub">出荷 ${r.shipped} ／ 売上 ${r.sold} ／ 残り ${r.left}</div>
          <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${width}%"></div></div>
        </div>
      </div>`;
    container.appendChild(row);
  });
}

function renderRanking(container, entries, maxTotal) {
  container.innerHTML = "";
  if (entries.length === 0) {
    container.innerHTML = `<div class="list-empty">この期間の売上はありません</div>`;
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const pct = maxTotal > 0 ? Math.max(4, Math.round((entry.total / maxTotal) * 100)) : 0;
    row.innerHTML = `
      <div class="rank-row" style="width:100%">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-bar-wrap">
          <div class="list-item-title">${escapeHtml(entry.name)}</div>
          <div class="list-item-sub">${entry.qty}個・${formatYen(entry.total)}</div>
          <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
    container.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 履歴 ----------

/**
 * 売った日の新しい順。入力した順ではないので、あとから前の日の分を
 * 入れても正しい位置に入る。同じ日の中では入力の新しいほうを上にする。
 */
function byDateNewestFirst(a, b) {
  const da = a.date || "";
  const dbb = b.date || "";
  if (da !== dbb) return da < dbb ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

/** 履歴画面の状態。売上と出荷は数が違いすぎるので切り替えで見る */
let historyKind = "sales";
let historyStoreFilter = "";
let historyLimit = 50;
const HISTORY_PAGE = 50;

document.querySelectorAll("#history-kind-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    historyKind = chip.dataset.kind;
    historyLimit = HISTORY_PAGE;
    renderHistory();
  });
});

document.getElementById("btn-history-more").addEventListener("click", () => {
  historyLimit += HISTORY_PAGE;
  renderHistory();
});

function renderHistoryStoreChips() {
  const row = document.getElementById("history-store-chips");
  row.innerHTML = "";
  if (db.stores.length === 0) {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  const makeChip = (id, label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (historyStoreFilter === id ? " active" : "");
    chip.textContent = label;
    chip.addEventListener("click", () => {
      historyStoreFilter = id;
      historyLimit = HISTORY_PAGE;
      renderHistory();
    });
    row.appendChild(chip);
  };

  makeChip("", "全店");
  db.stores.forEach((s) => makeChip(s.id, s.name));
}

function renderHistory() {
  document.querySelectorAll("#history-kind-chips .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.kind === historyKind);
  });
  renderHistoryStoreChips();

  const showingSales = historyKind === "sales";
  document.getElementById("history-title").textContent = showingSales
    ? "売上の履歴"
    : "出荷の履歴";

  const source = showingSales ? db.sales : db.restocks;
  const rows = source
    .filter((r) => !historyStoreFilter || r.storeId === historyStoreFilter)
    .sort(byDateNewestFirst);

  document.getElementById("history-count").textContent = String(rows.length);

  const list = document.getElementById("history-list");
  list.innerHTML = "";

  if (rows.length === 0) {
    list.innerHTML = `<div class="list-empty">${
      showingSales ? "売上の記録がありません" : "出荷の記録がありません"
    }</div>`;
    document.getElementById("btn-history-more").hidden = true;
    return;
  }

  rows.slice(0, historyLimit).forEach((r) => {
    list.appendChild(
      showingSales ? buildSaleHistoryItem(r) : buildRestockHistoryItem(r)
    );
  });

  const more = document.getElementById("btn-history-more");
  const remaining = rows.length - Math.min(historyLimit, rows.length);
  more.hidden = remaining === 0;
  more.textContent = `さらに表示（あと${remaining}件）`;
}

function buildSaleHistoryItem(s) {
  return buildListItem({
    title: `${s.storeName || "―"}　${s.productName}`,
    sub: `${s.date}・${s.qty}点${s.memo ? "・" + s.memo : ""}`,
    value: formatYen(s.total),
    onClick: () => openRecordEdit("sale", s.id),
    onDelete: () => deleteSale(s.id),
  });
}

function buildRestockHistoryItem(r) {
  // 店に納めるので、こちらから見れば「出荷」。memo の "出荷" は重ねない
  const kind = r.type === "in" ? "出荷" : "棚卸し";
  const memo = r.memo && r.memo !== "出荷" ? `・${r.memo}` : "";
  return buildListItem({
    title: `${r.storeName || "―"}　${r.productName}`,
    sub: `${r.date}・${kind}${memo}`,
    value: r.type === "in" ? `+${r.qty}点` : `→ ${r.qty}点`,
    onClick: () => openRecordEdit("restock", r.id),
    onDelete: () => deleteRestock(r.id),
  });
}

function deleteSale(id) {
  const sale = db.sales.find((s) => s.id === id);
  if (!sale) return;
  if (!confirm("この売上記録を削除しますか？在庫は元の数量に戻ります。")) return;
  const product = findProduct(sale.productId);
  if (product && sale.storeId) addStock(product, sale.storeId, sale.qty);
  db.sales = db.sales.filter((s) => s.id !== id);
  saveDB();
  showToast("削除しました");
  renderHistory();
}

function deleteRestock(id) {
  const restock = db.restocks.find((r) => r.id === id);
  if (!restock) return;
  let msg =
    restock.type === "in"
      ? `${restock.storeName || ""} ${restock.productName} ${restock.qty}点の出荷を削除しますか？\n\n在庫からその数量が引かれます。`
      : "この棚卸しの記録を削除しますか？\n\n在庫の数は戻りません。";
  if (!confirm(msg)) return;
  if (restock.type === "in") {
    const product = findProduct(restock.productId);
    if (product && restock.storeId) addStock(product, restock.storeId, -restock.qty);
  }
  db.restocks = db.restocks.filter((r) => r.id !== id);
  saveDB();
  showToast("削除しました");
  renderHistory();
}

// ---------- 履歴の修正 ----------

/**
 * 履歴から1件を開いて直す。売上と出荷で必要な項目が違うので、
 * 同じ画面の項目を出し入れして使い回す。
 */
let editingRecord = null;
let recordTotalTouched = false;

function fillProductSelect(select, selectedId, fallbackName) {
  select.innerHTML = "";
  db.products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  select.value = selectedId || "";
  // 記録した後で商品を消したときは、名前だけの選択肢を足して迷子にしない
  if (selectedId && select.value !== selectedId) {
    const opt = document.createElement("option");
    opt.value = selectedId;
    opt.textContent = `${fallbackName || "（削除された商品）"}（削除済み）`;
    select.insertBefore(opt, select.firstChild);
    select.value = selectedId;
  }
}

function findRecord(kind, id) {
  return kind === "sale"
    ? db.sales.find((s) => s.id === id)
    : db.restocks.find((r) => r.id === id);
}

function openRecordEdit(kind, id) {
  const rec = findRecord(kind, id);
  if (!rec) return;
  if (db.stores.length === 0) {
    showToast("先に店舗を登録してください");
    return;
  }

  const isSale = kind === "sale";
  const isAdjust = !isSale && rec.type === "adjust";
  editingRecord = { kind, id };
  recordTotalTouched = true; // 開いた時点の合計は記録どおりに残す

  document.getElementById("record-edit-title").textContent = isSale
    ? "売上を修正"
    : isAdjust
    ? "棚卸しを修正"
    : "出荷を修正";
  document.getElementById("record-edit-note").textContent = isAdjust
    ? "棚卸しは在庫の数を直接決めた記録です。ここを直しても在庫の数は変わりません。日付とメモだけ直せます。"
    : isSale
    ? "直すと在庫の数も合わせて計算し直します。"
    : "直すと在庫の数も合わせて計算し直します。";

  fillStoreSelect(document.getElementById("record-edit-store"), rec.storeId);
  fillProductSelect(
    document.getElementById("record-edit-product"),
    rec.productId,
    rec.productName
  );
  document.getElementById("record-edit-qty").value = String(rec.qty);
  document.getElementById("record-edit-date").value = rec.date || todayStr();
  document.getElementById("record-edit-memo").value = rec.memo || "";

  document.getElementById("record-edit-price-field").hidden = !isSale;
  document.getElementById("record-edit-total-field").hidden = !isSale;
  if (isSale) {
    document.getElementById("record-edit-price").value = String(rec.unitPrice);
    document.getElementById("record-edit-total").value = String(rec.total);
  }

  ["record-edit-store", "record-edit-product", "record-edit-qty"].forEach((elId) => {
    document.getElementById(elId).disabled = isAdjust;
  });

  updateRecordEditDiff();
  showScreen("record-edit");
}

/** 直したあと在庫がいくつになるかを、その場で見せる */
function updateRecordEditDiff() {
  const box = document.getElementById("record-edit-diff");
  if (!editingRecord) {
    box.hidden = true;
    return;
  }
  const rec = findRecord(editingRecord.kind, editingRecord.id);
  if (!rec || rec.type === "adjust") {
    box.hidden = true;
    return;
  }

  const storeId = document.getElementById("record-edit-store").value;
  const productId = document.getElementById("record-edit-product").value;
  const qty = Math.max(1, Number(document.getElementById("record-edit-qty").value) || 0);
  const product = findProduct(productId);
  const store = db.stores.find((s) => s.id === storeId);
  if (!product || !store) {
    box.hidden = true;
    return;
  }

  const applyDelta = editingRecord.kind === "sale" ? -qty : qty;
  const revertDelta = editingRecord.kind === "sale" ? rec.qty : -rec.qty;
  const current = getStock(product, storeId);
  const sameSlot = rec.productId === productId && rec.storeId === storeId;
  const after = current + (sameSlot ? revertDelta : 0) + applyDelta;

  box.hidden = false;
  box.textContent = `保存すると、${store.name}の${product.name}の在庫は ${current} → ${after} 点になります。`;
}

function recordEditInputs() {
  return [
    "record-edit-store",
    "record-edit-product",
    "record-edit-qty",
    "record-edit-price",
  ].map((id) => document.getElementById(id));
}

recordEditInputs().forEach((el) => {
  el.addEventListener("input", () => {
    const qty = Number(document.getElementById("record-edit-qty").value) || 0;
    const price = Number(document.getElementById("record-edit-price").value) || 0;
    // 数量や単価を触ったら合計は計算し直す。値引きを手で入れたい人は
    // 合計欄を直接いじれば、そちらが残る
    if (el.id !== "record-edit-store" && el.id !== "record-edit-product") {
      recordTotalTouched = false;
    }
    if (!recordTotalTouched) {
      document.getElementById("record-edit-total").value = String(qty * price);
    }
    updateRecordEditDiff();
  });
});

document.getElementById("record-edit-total").addEventListener("input", () => {
  recordTotalTouched = true;
});

document.getElementById("btn-record-edit-cancel").addEventListener("click", () => {
  editingRecord = null;
  showScreen("history");
});

document.getElementById("record-edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!editingRecord) return;
  const rec = findRecord(editingRecord.kind, editingRecord.id);
  if (!rec) {
    showToast("記録が見つかりませんでした");
    showScreen("history");
    return;
  }

  const isSale = editingRecord.kind === "sale";
  const isAdjust = !isSale && rec.type === "adjust";
  const date = document.getElementById("record-edit-date").value || todayStr();
  const memo = document.getElementById("record-edit-memo").value.trim();

  if (isAdjust) {
    rec.date = date;
    rec.memo = memo;
    saveDB();
    editingRecord = null;
    showToast("修正しました");
    showScreen("history");
    return;
  }

  const storeId = document.getElementById("record-edit-store").value;
  const productId = document.getElementById("record-edit-product").value;
  const qty = Math.max(1, Math.round(Number(document.getElementById("record-edit-qty").value) || 0));
  const store = db.stores.find((s) => s.id === storeId);
  const product = findProduct(productId);
  if (!store || !product) {
    showToast("店舗と商品を選んでください");
    return;
  }

  // 先に元の記録の分を在庫に戻してから、新しい内容を当てる
  const oldProduct = findProduct(rec.productId);
  if (oldProduct && rec.storeId) {
    addStock(oldProduct, rec.storeId, isSale ? rec.qty : -rec.qty);
  }
  addStock(product, storeId, isSale ? -qty : qty);

  rec.storeId = storeId;
  rec.storeName = store.name;
  rec.productId = productId;
  rec.productName = product.name;
  rec.qty = qty;
  rec.date = date;
  rec.memo = memo;

  if (isSale) {
    const unitPrice = Math.max(0, Math.round(Number(document.getElementById("record-edit-price").value) || 0));
    const totalInput = document.getElementById("record-edit-total").value;
    const total = totalInput === "" ? qty * unitPrice : Math.max(0, Math.round(Number(totalInput) || 0));
    rec.unitPrice = unitPrice;
    rec.total = total;
  }

  saveDB();
  editingRecord = null;
  showToast("修正しました");
  showScreen("history");
});

// ---------- 設定（バックアップ／復元／初期化） ----------

function backupFilename() {
  const d = new Date();
  return `greendays-backup-${toDateStr(d).replaceAll("-", "")}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
}

function backupJson() {
  return JSON.stringify(
    { app: "greenDays", version: 1, exportedAt: new Date().toISOString(), ...db },
    null,
    2
  );
}

/** iOS では共有シートのほうが確実に保存できるので、使える場合は優先する */
function canShareBackup() {
  if (!navigator.canShare || !navigator.share || typeof File === "undefined") return false;
  try {
    return navigator.canShare({
      files: [new File(["{}"], "test.json", { type: "application/json" })],
    });
  } catch (e) {
    return false;
  }
}

async function shareBackup() {
  const file = new File([backupJson()], backupFilename(), { type: "application/json" });
  try {
    await navigator.share({ files: [file], title: "グリーンデイズ バックアップ" });
    markBackedUp();
    showToast("バックアップを保存しました");
  } catch (err) {
    if (err && err.name === "AbortError") return; // ユーザーがキャンセルしただけ
    console.warn("共有に失敗したためダウンロードに切り替えます", err);
    downloadBackup();
  }
}

function downloadBackup() {
  const blob = new Blob([backupJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp();
  showToast("バックアップを書き出しました");
}

document.getElementById("btn-share").addEventListener("click", shareBackup);
document.getElementById("btn-export").addEventListener("click", downloadBackup);
document.getElementById("btn-banner-backup").addEventListener("click", () => {
  showScreen("settings");
  if (canShareBackup()) shareBackup();
  else downloadBackup();
});

function handleBackupFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed.products) || !Array.isArray(parsed.sales)) {
        throw new Error("形式が正しくありません");
      }
      const storeCount = Array.isArray(parsed.stores) ? parsed.stores.length : 0;
      const summary =
        `店舗 ${storeCount}件 / 商品 ${parsed.products.length}件 / 売上 ${parsed.sales.length}件` +
        `\n\n今のデータ（店舗 ${db.stores.length}件 / 商品 ${db.products.length}件 / 売上 ${db.sales.length}件）と置きかえます。` +
        `\n置きかえる前の状態は復元ポイントに残ります。よろしいですか？`;
      if (!confirm(summary)) {
        e.target.value = "";
        return;
      }
      takeSnapshot("読み込みの直前");
      db = normalizeDB(parsed);
      saveDB();
      showToast("データを読み込みました");
      showScreen("home");
    } catch (err) {
      alert("読み込みに失敗しました。正しいバックアップファイルを選んでください。");
      console.error(err);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

// 設定からも、データが空のときのホーム画面からも同じ復元ができる
document.getElementById("import-file").addEventListener("change", handleBackupFileChosen);
document.getElementById("empty-import-file").addEventListener("change", handleBackupFileChosen);

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("すべてのデータを削除します。よろしいですか？\n\n（削除の直前の状態は復元ポイントに残ります）")) return;
  if (!confirm("本当に削除してよろしいですか？")) return;
  takeSnapshot("全削除の直前");
  db = emptyDB();
  saveDB();
  showToast("すべてのデータを削除しました");
  showScreen("home");
});

function restoreSnapshot(index) {
  const list = loadSnapshots();
  const snap = list[index];
  if (!snap) return;
  const d = new Date(snap.at);
  const label = `${toDateStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const message =
    `${label} の状態に戻します。\n` +
    `（商品 ${snap.data.products.length}件 / 売上 ${snap.data.sales.length}件）\n\n` +
    `今のデータは置きかえられますが、戻す直前の状態も復元ポイントに残ります。よろしいですか？`;
  if (!confirm(message)) return;

  takeSnapshot("復元の直前");
  db = normalizeDB(snap.data);
  saveDB();
  showToast("復元しました");
  showScreen("home");
}

// ---------- 店舗の管理 ----------

document.getElementById("store-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("store-name-input");
  const name = input.value.trim();
  if (!name) return;
  if (db.stores.some((s) => s.name === name)) {
    showToast("同じ名前の店舗があります");
    return;
  }
  db.stores.push({ id: uid(), name, createdAt: Date.now() });
  saveDB();
  input.value = "";
  showToast("店舗を追加しました");
  renderStoreList();
});

function renameStore(id) {
  const store = findStore(id);
  if (!store) return;
  const name = prompt("店舗名を変更", store.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (db.stores.some((s) => s.id !== id && s.name === trimmed)) {
    showToast("同じ名前の店舗があります");
    return;
  }
  store.name = trimmed;
  // 記録側に控えている店舗名も追従させる（履歴の表示に使うため）
  db.sales.forEach((s) => { if (s.storeId === id) s.storeName = trimmed; });
  db.restocks.forEach((r) => { if (r.storeId === id) r.storeName = trimmed; });
  saveDB();
  showToast("店舗名を変更しました");
  renderStoreList();
}

function deleteStore(id) {
  const store = findStore(id);
  if (!store) return;
  const salesCount = db.sales.filter((s) => s.storeId === id).length;
  const message =
    `「${store.name}」を削除しますか？\n\n` +
    `この店舗の在庫数は消えますが、売上の記録${salesCount}件はそのまま残ります。`;
  if (!confirm(message)) return;
  db.stores = db.stores.filter((s) => s.id !== id);
  db.products.forEach((p) => {
    if (p.stockByStore) delete p.stockByStore[id];
  });
  if (stockStoreFilter === id) stockStoreFilter = "";
  if (reportStoreFilter === id) reportStoreFilter = "";
  saveDB();
  showToast("店舗を削除しました");
  renderStoreList();
}

function renderStoreList() {
  const container = document.getElementById("store-list");
  document.getElementById("store-count").textContent = String(db.stores.length);
  container.innerHTML = "";
  if (db.stores.length === 0) {
    container.innerHTML = `<div class="list-empty">まだ店舗が登録されていません</div>`;
    return;
  }
  db.stores.forEach((store) => {
    const salesTotal = db.sales
      .filter((s) => s.storeId === store.id)
      .reduce((sum, s) => sum + s.total, 0);
    const row = buildListItem({
      title: store.name,
      sub: `売上 ${formatYen(salesTotal)}`,
      value: "",
      onClick: () => renameStore(store.id),
      onDelete: () => deleteStore(store.id),
    });
    container.appendChild(row);
  });
}

function renderSettings() {
  document.getElementById("btn-share").hidden = !canShareBackup();

  document.getElementById("status-records").textContent =
    `店舗 ${db.stores.length} / 商品 ${db.products.length} / 売上 ${db.sales.length} / 入出庫 ${db.restocks.length}`;
  renderStoreList();

  const meta = loadBackupMeta();
  const lastEl = document.getElementById("status-last-backup");
  if (!meta.at) {
    lastEl.textContent = "まだなし";
    lastEl.classList.toggle("warn", totalRecordCount() > 0);
  } else {
    const days = daysSince(meta.at);
    const d = new Date(meta.at);
    const when = days === 0 ? "今日" : days === 1 ? "昨日" : `${toDateStr(d)}（${days}日前）`;
    const pending = pendingChanges(meta);
    lastEl.textContent = pending > 0 ? `${when}・その後${pending}回の変更` : when;
    lastEl.classList.toggle(
      "warn",
      days >= BACKUP_REMINDER_DAYS || pending >= BACKUP_REMINDER_RECORDS
    );
  }

  document.getElementById("status-version").textContent = APP_VERSION;

  renderSnapshotList();
  updatePersistStatus();
  renderLockSettings();
}

/**
 * 端末が覚えている古いアプリ本体を捨てて読み込み直す。
 * 消すのはキャッシュと Service Worker だけで、localStorage には触らない。
 */
document.getElementById("btn-force-update").addEventListener("click", async () => {
  if (!confirm("最新の状態に読み込み直します。\n\n売上や在庫のデータは消えません。よろしいですか？")) return;

  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("greendays-cache-")).map((k) => caches.delete(k))
      );
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.warn("キャッシュの削除に失敗しました", e);
  }

  // 同じURLだと端末が再び古いものを出すことがあるので、印を付けて読み直す
  const url = new URL(location.href);
  url.searchParams.set("v", Date.now().toString(36));
  location.replace(url.toString());
});

function renderSnapshotList() {
  const list = loadSnapshots();
  const container = document.getElementById("snapshot-list");
  document.getElementById("snapshot-count").textContent = String(list.length);
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = `<div class="list-empty">まだ復元ポイントはありません</div>`;
    return;
  }

  list.forEach((snap, i) => {
    const d = new Date(snap.at);
    const el = document.createElement("div");
    el.className = "list-item snapshot-item";
    el.innerHTML = `
      <div class="snapshot-head">
        <span class="snapshot-reason">${escapeHtml(snap.reason)}</span>
        <span class="snapshot-when">${toDateStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}</span>
      </div>
      <div class="snapshot-counts">商品 ${snap.data.products.length}件 ／ 売上 ${snap.data.sales.length}件</div>`;

    const actions = document.createElement("div");
    actions.className = "snapshot-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn btn-secondary";
    restore.textContent = "この状態に戻す";
    restore.addEventListener("click", () => restoreSnapshot(i));
    actions.appendChild(restore);
    el.appendChild(actions);

    container.appendChild(el);
  });
}

/**
 * 端末に「消さないでほしい」と申請した状態かを表示する。
 * これが有効だと、ブラウザが容量確保のために勝手に消すことがなくなる。
 */
async function updatePersistStatus() {
  const el = document.getElementById("status-persist");
  const hint = document.getElementById("persist-hint");
  if (!el || !hint) return;

  if (!navigator.storage || !navigator.storage.persisted) {
    el.textContent = "確認できません";
    el.classList.add("warn");
    hint.hidden = false;
    hint.textContent =
      "このブラウザでは保護状態を確認できません。こまめな書き出しをおすすめします。";
    return;
  }

  let persisted = false;
  try {
    persisted = await navigator.storage.persisted();
  } catch (e) {
    /* 判定できないときは未保護として扱う */
  }

  if (persisted) {
    el.textContent = "保護されています";
    el.classList.remove("warn");
    hint.hidden = false;
    hint.textContent =
      "端末の空き容量が減っても、このアプリのデータが自動で消されることはありません。" +
      "ただし手動でブラウザのデータを消した場合や、端末が壊れた場合は失われます。";
  } else {
    el.textContent = "保護されていません";
    el.classList.add("warn");
    hint.hidden = false;
    hint.textContent =
      "ホーム画面に追加して何度か使うと、保護が有効になることがあります。" +
      "いずれにせよ、定期的な書き出しが一番確実です。";
  }
}

/** 起動時に一度だけ、データを消さないよう端末に申請する */
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist || !navigator.storage.persisted) return;
  try {
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch (e) {
    console.warn("永続化の申請に失敗しました", e);
  }
}

// ---------- アプリのロック（顔認証・指紋） ----------
//
// WebAuthn の「プラットフォーム認証器」を使う。端末が顔・指紋の確認をした
// という事実だけを利用するもので、データ自体を暗号化するわけではない。
// つまり、のぞき見は防げるが、端末を解析されるところまでは守れない。
//
// 設定は db とは別のキーに置く。バックアップに混ざると、パスキーの無い
// 別の端末で読み込んだときに開けなくなるため。

const LOCK_KEY = "greenDays.lock.v1";

let lockConfig = loadLockConfig();
let isLocked = false;
let lastHiddenAt = null;

function loadLockConfig() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !parsed.credentialId) return { enabled: false, credentialId: null, graceSeconds: 60 };
    return {
      enabled: Boolean(parsed.enabled),
      credentialId: parsed.credentialId,
      graceSeconds: Number.isFinite(parsed.graceSeconds) ? parsed.graceSeconds : 60,
    };
  } catch (e) {
    return { enabled: false, credentialId: null, graceSeconds: 60 };
  }
}

function saveLockConfig() {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(lockConfig));
  } catch (e) {
    console.warn("ロック設定を保存できませんでした", e);
  }
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bufToBase64url(buf) {
  let binary = "";
  new Uint8Array(buf).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuf(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function biometricsAvailable() {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  if (!window.isSecureContext) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

async function registerLock() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      // rp.id は指定しない。省略すると現在のドメインが使われ、
      // github.io のような共有ドメインでも正しく登録できる。
      rp: { name: "グリーンデイズ" },
      user: {
        id: randomBytes(16),
        name: "owner",
        displayName: "オーナー",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    },
  });
  if (!credential) throw new Error("登録できませんでした");
  return bufToBase64url(credential.rawId);
}

async function verifyLock() {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: lockConfig.credentialId
        ? [{ type: "public-key", id: base64urlToBuf(lockConfig.credentialId) }]
        : [],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return Boolean(assertion);
}

function engageLock() {
  if (!lockConfig.enabled) return;
  isLocked = true;
  document.documentElement.classList.add("app-locked");
  document.getElementById("lock-message").textContent = "ロックを解除してください";
  document.getElementById("lock-screen").hidden = false;
}

function releaseLock() {
  isLocked = false;
  document.documentElement.classList.remove("app-locked");
  document.getElementById("lock-screen").hidden = true;
}

/**
 * @param {boolean} silent 自動で試みた場合は、失敗しても文言を変えない
 *   （ユーザー操作なしの認証はブラウザに拒否されることがあるため）
 */
async function attemptUnlock(silent) {
  const message = document.getElementById("lock-message");
  try {
    if (await verifyLock()) {
      releaseLock();
      return true;
    }
    if (!silent) message.textContent = "解除できませんでした。もう一度お試しください。";
  } catch (err) {
    if (!silent) {
      message.textContent =
        err && err.name === "NotAllowedError"
          ? "認証がキャンセルされました。もう一度お試しください。"
          : "解除できませんでした。もう一度お試しください。";
    }
  }
  return false;
}

document.getElementById("btn-unlock").addEventListener("click", () => attemptUnlock(false));

document.getElementById("btn-lock-help").addEventListener("click", () => {
  const ok = confirm(
    "顔認証が使えない場合は、ロックを解除して設定をオフにできます。\n\n" +
      "データは消えません。ロックはのぞき見防止のための機能で、" +
      "データそのものを守るものではないため、この方法を用意しています。\n\n" +
      "ロックをオフにしますか？"
  );
  if (!ok) return;
  if (!confirm("本当にロックをオフにしますか？")) return;
  lockConfig = { enabled: false, credentialId: null, graceSeconds: lockConfig.graceSeconds };
  saveLockConfig();
  releaseLock();
  showToast("ロックをオフにしました");
});

document.getElementById("lock-toggle").addEventListener("change", async (e) => {
  const toggle = e.target;
  if (toggle.checked) {
    toggle.disabled = true;
    try {
      const credentialId = await registerLock();
      lockConfig = { enabled: true, credentialId, graceSeconds: lockConfig.graceSeconds };
      saveLockConfig();
      showToast("ロックをオンにしました");
    } catch (err) {
      console.warn("ロックの登録に失敗しました", err);
      toggle.checked = false;
      alert(
        err && err.name === "NotAllowedError"
          ? "登録がキャンセルされました。"
          : "この端末では顔認証・指紋を登録できませんでした。"
      );
    } finally {
      toggle.disabled = false;
    }
  } else {
    lockConfig = { enabled: false, credentialId: null, graceSeconds: lockConfig.graceSeconds };
    saveLockConfig();
    showToast("ロックをオフにしました");
  }
  renderLockSettings();
});

document.getElementById("lock-grace").addEventListener("change", (e) => {
  lockConfig.graceSeconds = Number(e.target.value);
  saveLockConfig();
});

async function renderLockSettings() {
  const availabilityEl = document.getElementById("lock-availability");
  const controls = document.getElementById("lock-controls");
  const toggle = document.getElementById("lock-toggle");
  const graceField = document.getElementById("lock-grace-field");

  const available = await biometricsAvailable();
  if (!available) {
    availabilityEl.textContent =
      "この端末・ブラウザでは顔認証や指紋によるロックを利用できません。" +
      "iPhoneの場合は、ホーム画面に追加してから開くと使えることがあります。";
    controls.hidden = true;
    return;
  }

  availabilityEl.textContent =
    "アプリを開くときに、この端末の顔認証・指紋での確認を求めます。";
  controls.hidden = false;
  toggle.checked = lockConfig.enabled;
  graceField.hidden = !lockConfig.enabled;
  document.getElementById("lock-grace").value = String(lockConfig.graceSeconds);
}

// バックグラウンドから戻ったとき、離れていた時間が猶予を超えていれば掛け直す
document.addEventListener("visibilitychange", () => {
  if (!lockConfig.enabled) return;
  if (document.hidden) {
    lastHiddenAt = Date.now();
    return;
  }
  if (isLocked) return;
  const awaySeconds = (Date.now() - (lastHiddenAt || Date.now())) / 1000;
  if (awaySeconds >= lockConfig.graceSeconds) engageLock();
});

// ---------- 初期化 ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

requestPersistentStorage();
showScreen("home");

if (lockConfig.enabled) {
  engageLock();
  // 自動で認証を出せるブラウザではそのまま顔認証へ。
  // 拒否された場合は解除ボタンからの操作を待つ。
  attemptUnlock(true);
} else {
  // head のスクリプトが付けたクラスを必ず外す。
  // 残したままだと画面が空白のままになる。
  document.documentElement.classList.remove("app-locked");
}
