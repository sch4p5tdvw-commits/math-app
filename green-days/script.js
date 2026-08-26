"use strict";

/*
 * グリーンデイズ 売上・在庫管理アプリ
 * データはすべて localStorage（この端末のブラウザ内）だけに保存され、
 * どこにも送信されません。ネットワーク通信は一切行いません。
 */

const STORAGE_KEY = "greenDays.v1";
const SNAPSHOT_KEY = "greenDays.snapshots.v1";
const BACKUP_META_KEY = "greenDays.backupMeta.v1";

const MAX_SNAPSHOTS = 5;
const BACKUP_REMINDER_DAYS = 7;

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
  return { products: [], sales: [], restocks: [] };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDB();
    const parsed = JSON.parse(raw);
    return {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      restocks: Array.isArray(parsed.restocks) ? parsed.restocks : [],
    };
  } catch (e) {
    console.error("データの読み込みに失敗しました", e);
    return emptyDB();
  }
}

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
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
  return db.products.length + db.sales.length + db.restocks.length;
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
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    return raw ? JSON.parse(raw) : { at: null, recordCount: 0 };
  } catch (e) {
    return { at: null, recordCount: 0 };
  }
}

function markBackedUp() {
  try {
    localStorage.setItem(
      BACKUP_META_KEY,
      JSON.stringify({ at: Date.now(), recordCount: totalRecordCount() })
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
  // 前回のバックアップ以降に増減がなければ催促しない
  if (meta.at && meta.recordCount === count) {
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
  if (days >= BACKUP_REMINDER_DAYS) {
    banner.hidden = false;
    detail.textContent = `前回から${days}日、${count - meta.recordCount}件ふえています`;
    return;
  }
  banner.hidden = true;
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

const SCREENS = ["home", "sale", "stock", "report", "history", "settings", "product-form", "import"];

function showScreen(name, opts = {}) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = s !== name;
  });
  const SUB_SCREEN_TABS = { "product-form": "stock", import: "sale" };
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
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

// ---------- ホーム ----------

function renderHome() {
  updateBackupBanner();
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

  const lowStock = db.products.filter((p) => p.stock <= p.lowStock);
  document.getElementById("home-low-stock-badge").textContent = String(lowStock.length);
  const lowStockList = document.getElementById("home-low-stock-list");
  lowStockList.innerHTML = "";
  if (lowStock.length === 0) {
    lowStockList.innerHTML = `<div class="list-empty">在庫少の商品はありません</div>`;
  } else {
    lowStock
      .sort((a, b) => a.stock - b.stock)
      .forEach((p) => {
        lowStockList.appendChild(
          buildListItem({
            title: p.name,
            sub: `しきい値 ${p.lowStock}`,
            value: `残り ${p.stock}`,
            low: true,
            onClick: () => openProductForm(p.id),
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
          sub: `${s.date}・${s.qty}個`,
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
  const select = document.getElementById("sale-product");
  select.innerHTML = "";
  if (db.products.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "先に「在庫」タブで商品を登録してください";
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
  } else {
    db.products.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name}（在庫 ${p.stock}）`;
      select.appendChild(opt);
    });
  }
  document.getElementById("sale-date").value = todayStr();
  document.getElementById("sale-qty").value = "1";
  document.getElementById("sale-memo").value = "";
  syncSalePriceFromProduct();
  updateSalePreview();
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
  const product = findProduct(productId);
  const warning = document.getElementById("sale-stock-warning");
  if (product && qty > product.stock) {
    warning.hidden = false;
    warning.textContent = `⚠ 在庫（${product.stock}）を超えています。記録すると在庫はマイナスになります。`;
  } else {
    warning.hidden = true;
  }
}

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
  if (qty > product.stock) {
    if (!confirm(`在庫（${product.stock}）を超えています。このまま記録しますか？`)) return;
  }

  const sale = {
    id: uid(),
    productId: product.id,
    productName: product.name,
    qty,
    unitPrice,
    total: qty * unitPrice,
    date,
    memo,
    createdAt: Date.now(),
  };
  db.sales.push(sale);
  product.stock -= qty;
  saveDB();
  showToast("売上を記録しました");
  showScreen("home");
});

// ---------- 在庫・商品管理 ----------

function renderStockList() {
  const list = document.getElementById("product-list");
  list.innerHTML = "";
  if (db.products.length === 0) {
    list.innerHTML = `<div class="list-empty">まだ商品が登録されていません。「＋ 商品追加」から登録してください</div>`;
    return;
  }
  [...db.products]
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .forEach((p) => {
      list.appendChild(
        buildListItem({
          title: p.name,
          sub: (p.category ? `${p.category}・` : "") + formatYen(p.price),
          value: `在庫 ${p.stock}`,
          low: p.stock <= p.lowStock,
          onClick: () => openProductForm(p.id),
        })
      );
    });
}

document.getElementById("btn-new-product").addEventListener("click", () => openProductForm(null));

function openProductForm(id) {
  const product = id ? findProduct(id) : null;
  document.getElementById("product-form-title").textContent = product ? "商品を編集" : "商品を追加";
  document.getElementById("product-id").value = product ? product.id : "";
  document.getElementById("product-name").value = product ? product.name : "";
  document.getElementById("product-category").value = product ? product.category || "" : "";
  document.getElementById("product-price").value = product ? product.price : "";
  document.getElementById("product-stock").value = product ? product.stock : 0;
  document.getElementById("product-low-stock").value = product ? product.lowStock : 5;
  document.getElementById("btn-product-delete").hidden = !product;

  const restockForm = document.getElementById("restock-form");
  restockForm.closest(".card").style.display = product ? "" : "none";
  if (product) {
    document.getElementById("restock-date").value = todayStr();
    document.getElementById("restock-qty").value = "";
    document.getElementById("restock-memo").value = "";
    document.getElementById("restock-type").value = "in";
    updateRestockLabel();
  }

  showScreen("product-form", { activeTab: "stock" });
}

document.getElementById("btn-product-cancel").addEventListener("click", () => showScreen("stock"));

document.getElementById("product-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("product-id").value;
  const name = document.getElementById("product-name").value.trim();
  const category = document.getElementById("product-category").value.trim();
  const price = Number(document.getElementById("product-price").value);
  const stock = Number(document.getElementById("product-stock").value);
  const lowStock = Number(document.getElementById("product-low-stock").value);

  if (!name) {
    showToast("商品名を入力してください");
    return;
  }
  if (price < 0 || Number.isNaN(price) || stock < 0 || Number.isNaN(stock)) {
    showToast("価格・在庫数を正しく入力してください");
    return;
  }

  if (id) {
    const product = findProduct(id);
    if (product) {
      product.name = name;
      product.category = category;
      product.price = price;
      product.stock = stock;
      product.lowStock = lowStock;
    }
  } else {
    db.products.push({
      id: uid(),
      name,
      category,
      price,
      stock,
      lowStock,
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

  const type = document.getElementById("restock-type").value;
  const qty = Number(document.getElementById("restock-qty").value);
  const date = document.getElementById("restock-date").value || todayStr();
  const memo = document.getElementById("restock-memo").value.trim();

  if (Number.isNaN(qty) || qty < 0) {
    showToast("数量を正しく入力してください");
    return;
  }

  if (type === "in") {
    product.stock += qty;
  } else {
    product.stock = qty;
  }

  db.restocks.push({
    id: uid(),
    productId: product.id,
    productName: product.name,
    type,
    qty,
    date,
    memo,
    createdAt: Date.now(),
  });

  saveDB();
  document.getElementById("product-stock").value = product.stock;
  document.getElementById("restock-qty").value = "";
  document.getElementById("restock-memo").value = "";
  showToast(type === "in" ? "入荷を記録しました" : "棚卸しを記録しました");
});

// ---------- チャット・スクショからの取込 ----------
//
// 画像の文字認識は端末（iOSの「テキスト認識表示」など）の機能で行ってもらい、
// このアプリは貼り付けられたテキストを解析するだけ。よって画像もテキストも
// 外部には一切送信されない。

/** 全角数字・全角英字・全角スペースを半角へそろえる */
function normalizeText(str) {
  return String(str)
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .replace(/　/g, " ");
}

/** 商品名の照合用キー（空白・記号を落として小文字化） */
function matchKey(str) {
  return normalizeText(str).toLowerCase().replace(/[\s・･,，、.。'"’”「」()（）]/g, "");
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

const QTY_UNITS = "個|コ|こ|点|本|袋|パック|枚|箱|束|杯|皿|人前|セット|ケース|pcs|pc";

/** 行から数量を取り出す。見つからなければ null */
function extractQty(line) {
  let m = line.match(new RegExp(`(\\d+)\\s*(?:${QTY_UNITS})`));
  if (m) return Number(m[1]);
  m = line.match(/[×xX*]\s*(\d+)/);
  if (m) return Number(m[1]);
  return null;
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

/** 行に含まれる登録済み商品を探す（最長一致） */
function findProductInLine(line) {
  const key = matchKey(line);
  let best = null;
  db.products.forEach((p) => {
    const pk = matchKey(p.name);
    if (pk && key.includes(pk)) {
      if (!best || pk.length > matchKey(best.name).length) best = p;
    }
  });
  return best;
}

/** 1行を売上候補に変換する。候補にならない行は null */
function parseSaleLine(line, contextDate) {
  const product = findProductInLine(line);
  const qty = extractQty(line);
  const prices = extractPrices(line);

  // 商品も見つからず、数量と金額の両方がそろってもいない行は売上ではないと判断
  if (!product && !(qty !== null && prices.length > 0)) return null;

  const finalQty = qty !== null && qty > 0 ? qty : 1;
  let unitPrice = null;

  const explicitUnit = prices.find((p) => p.isUnit);
  if (explicitUnit) {
    unitPrice = explicitUnit.value;
  } else if (prices.length >= 2) {
    // 「@150 450円」のように単価と合計が並ぶケース
    unitPrice = Math.min(prices[0].value, prices[1].value);
  } else if (prices.length === 1) {
    const price = prices[0].value;
    if (product && price === product.price) {
      unitPrice = price; // 登録単価とぴったり一致
    } else if (finalQty > 1 && price % finalQty === 0) {
      unitPrice = price / finalQty; // 合計とみなして割り戻す
    } else {
      unitPrice = price;
    }
  } else if (product) {
    unitPrice = product.price; // 金額の記載なし → 登録単価を使う
  }

  if (unitPrice === null || Number.isNaN(unitPrice)) unitPrice = 0;

  return {
    id: uid(),
    source: line,
    productId: product ? product.id : "",
    qty: finalQty,
    unitPrice,
    date: contextDate,
    include: Boolean(product),
  };
}

function parseChatText(text) {
  const lines = normalizeText(text).split(/\r?\n/);
  const rows = [];
  let contextDate = todayStr();
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const dateFound = extractDate(line);
    if (dateFound) contextDate = dateFound;
    const row = parseSaleLine(line, contextDate);
    if (row) rows.push(row);
  });
  return rows;
}

/** @type {Array} 取込プレビューの現在の内容 */
let importRows = [];

document.getElementById("btn-open-import").addEventListener("click", () => {
  document.getElementById("import-text").value = "";
  document.getElementById("import-result-card").hidden = true;
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
    showToast("先に「在庫」タブで商品を登録してください");
    return;
  }
  importRows = parseChatText(text);
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
    el.className = "import-row" + (row.productId ? "" : " unmatched");

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
      updateRowTotal(el, row);
      updateImportTotal();
    });
    priceField.appendChild(priceInput);
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
  if (totalEl) totalEl.textContent = `小計 ${formatYen(row.qty * row.unitPrice)}`;
}

function updateImportTotal() {
  const selected = importRows.filter((r) => r.include && r.productId);
  const total = selected.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
  document.getElementById("import-total").textContent = formatYen(total);
  document.getElementById("import-count").textContent = String(selected.length);
}

document.getElementById("btn-import-commit").addEventListener("click", () => {
  const selected = importRows.filter((r) => r.include && r.productId && r.qty > 0);
  if (selected.length === 0) {
    showToast("登録する行がありません");
    return;
  }

  const skipped = importRows.filter((r) => r.include && !r.productId).length;
  let message = `${selected.length}件の売上を登録します。よろしいですか？`;
  if (skipped > 0) message += `\n（商品が未選択の${skipped}件はスキップされます）`;
  if (!confirm(message)) return;

  selected.forEach((row) => {
    const product = findProduct(row.productId);
    if (!product) return;
    db.sales.push({
      id: uid(),
      productId: product.id,
      productName: product.name,
      qty: row.qty,
      unitPrice: row.unitPrice,
      total: row.qty * row.unitPrice,
      date: row.date,
      memo: "チャットから取込",
      createdAt: Date.now(),
    });
    product.stock -= row.qty;
  });

  saveDB();
  importRows = [];
  document.getElementById("import-text").value = "";
  document.getElementById("import-result-card").hidden = true;
  showToast(`${selected.length}件を登録しました`);
  showScreen("home");
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

function renderReport() {
  const { from, to } = getRangeDates(currentReportRange);
  const filtered = db.sales.filter((s) => {
    if (from && s.date < from) return false;
    if (to && s.date > to) return false;
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

  const rankingEl = document.getElementById("report-ranking");
  rankingEl.innerHTML = "";
  if (ranking.length === 0) {
    rankingEl.innerHTML = `<div class="list-empty">この期間の売上はありません</div>`;
    return;
  }
  ranking.forEach((entry, i) => {
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
    rankingEl.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 履歴 ----------

function renderHistory() {
  const salesList = document.getElementById("history-sales-list");
  salesList.innerHTML = "";
  const sortedSales = [...db.sales].sort((a, b) => b.createdAt - a.createdAt);
  if (sortedSales.length === 0) {
    salesList.innerHTML = `<div class="list-empty">まだ売上の記録がありません</div>`;
  } else {
    sortedSales.forEach((s) => {
      salesList.appendChild(
        buildListItem({
          title: s.productName,
          sub: `${s.date}・${s.qty}個${s.memo ? "・" + s.memo : ""}`,
          value: formatYen(s.total),
          onDelete: () => deleteSale(s.id),
        })
      );
    });
  }

  const restockList = document.getElementById("history-restock-list");
  restockList.innerHTML = "";
  const sortedRestocks = [...db.restocks].sort((a, b) => b.createdAt - a.createdAt);
  if (sortedRestocks.length === 0) {
    restockList.innerHTML = `<div class="list-empty">まだ入荷・棚卸しの記録がありません</div>`;
  } else {
    sortedRestocks.forEach((r) => {
      restockList.appendChild(
        buildListItem({
          title: r.productName,
          sub: `${r.date}・${r.type === "in" ? "入荷" : "棚卸し"}${r.memo ? "・" + r.memo : ""}`,
          value: r.type === "in" ? `+${r.qty}` : `→ ${r.qty}`,
          onDelete: () => deleteRestock(r.id),
        })
      );
    });
  }
}

function deleteSale(id) {
  const sale = db.sales.find((s) => s.id === id);
  if (!sale) return;
  if (!confirm("この売上記録を削除しますか？在庫は元の数量に戻ります。")) return;
  const product = findProduct(sale.productId);
  if (product) product.stock += sale.qty;
  db.sales = db.sales.filter((s) => s.id !== id);
  saveDB();
  showToast("削除しました");
  renderHistory();
}

function deleteRestock(id) {
  const restock = db.restocks.find((r) => r.id === id);
  if (!restock) return;
  let msg = "この記録を削除しますか？";
  if (restock.type === "in") msg += "在庫からその数量が引かれます。";
  if (!confirm(msg)) return;
  if (restock.type === "in") {
    const product = findProduct(restock.productId);
    if (product) product.stock = Math.max(0, product.stock - restock.qty);
  }
  db.restocks = db.restocks.filter((r) => r.id !== id);
  saveDB();
  showToast("削除しました");
  renderHistory();
}

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

document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed.products) || !Array.isArray(parsed.sales)) {
        throw new Error("形式が正しくありません");
      }
      const summary =
        `商品 ${parsed.products.length}件 / 売上 ${parsed.sales.length}件` +
        `\n\n今のデータ（商品 ${db.products.length}件 / 売上 ${db.sales.length}件）と置きかえます。` +
        `\n置きかえる前の状態は復元ポイントに残ります。よろしいですか？`;
      if (!confirm(summary)) {
        e.target.value = "";
        return;
      }
      takeSnapshot("読み込みの直前");
      db = {
        products: parsed.products || [],
        sales: parsed.sales || [],
        restocks: Array.isArray(parsed.restocks) ? parsed.restocks : [],
      };
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
});

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
  db = {
    products: snap.data.products || [],
    sales: snap.data.sales || [],
    restocks: snap.data.restocks || [],
  };
  saveDB();
  showToast("復元しました");
  showScreen("home");
}

function renderSettings() {
  document.getElementById("btn-share").hidden = !canShareBackup();

  document.getElementById("status-records").textContent =
    `商品 ${db.products.length} / 売上 ${db.sales.length} / 入出庫 ${db.restocks.length}`;

  const meta = loadBackupMeta();
  const lastEl = document.getElementById("status-last-backup");
  if (!meta.at) {
    lastEl.textContent = "まだなし";
    lastEl.classList.toggle("warn", totalRecordCount() > 0);
  } else {
    const days = daysSince(meta.at);
    const d = new Date(meta.at);
    lastEl.textContent =
      days === 0 ? "今日" : days === 1 ? "昨日" : `${toDateStr(d)}（${days}日前）`;
    lastEl.classList.toggle("warn", days >= BACKUP_REMINDER_DAYS);
  }

  renderSnapshotList();
  updatePersistStatus();
}

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
