"use strict";

/*
 * グリーンデイズ 売上・在庫管理アプリ
 * データはすべて localStorage（この端末のブラウザ内）だけに保存され、
 * どこにも送信されません。ネットワーク通信は一切行いません。
 */

const STORAGE_KEY = "greenDays.v1";

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
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

const SCREENS = ["home", "sale", "stock", "report", "history", "settings", "product-form"];

function showScreen(name, opts = {}) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = s !== name;
  });
  const activeTab = opts.activeTab || (SCREENS.includes(name) && name !== "product-form" ? name : null);
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === activeTab);
  });
  window.scrollTo(0, 0);

  if (name === "home") renderHome();
  if (name === "sale") renderSaleScreen();
  if (name === "stock") renderStockList();
  if (name === "report") renderReport();
  if (name === "history") renderHistory();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

// ---------- ホーム ----------

function renderHome() {
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

// ---------- 設定（バックアップ／初期化） ----------

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = todayStr().replaceAll("-", "");
  a.href = url;
  a.download = `greendays-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました");
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
      if (!confirm("読み込んだデータで、今のデータを上書きします。よろしいですか？")) {
        e.target.value = "";
        return;
      }
      db = {
        products: parsed.products || [],
        sales: parsed.sales || [],
        restocks: parsed.restocks || [],
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
  if (!confirm("すべてのデータを削除します。この操作は元にもどせません。よろしいですか？")) return;
  if (!confirm("本当に削除してよろしいですか？")) return;
  db = emptyDB();
  saveDB();
  showToast("すべてのデータを削除しました");
  showScreen("home");
});

// ---------- 初期化 ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

showScreen("home");
