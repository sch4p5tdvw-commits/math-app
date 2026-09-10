"use strict";

// 楽天お買い物マラソンの「買いまわり」でもらえるポイントを、買う前に見積もるための計算機。
// 通信は一切しない。入力はこの端末の localStorage にだけ残る。

// ===== 定数 =====
const STORE_KEY = "rakuten-marathon-v1";
const SHOP_MIN = 1000;      // 買いまわりの対象になる 1ショップあたりの金額（税込）
const MAX_SHOPS = 10;       // 倍率が上がるのはここまで
const DEFAULT_KAIMAWARI_CAP = 7000; // 買いまわり分のポイント上限（開催回ごとに変わる）
const MAX_ROWS = 30;

// ===== 状態 =====
let store = null;
let rowRefs = new Map(); // ショップ行の id => 表示を書きかえる要素

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("ja-JP");
const uid = () => Math.random().toString(36).slice(2, 9);

// ===== 保存 =====
function blankStore() {
  return {
    shops: [newShop(), newShop(), newShop()],
    spuRate: "",
    spuCap: "",
    kaimawariCap: String(DEFAULT_KAIMAWARI_CAP),
    campaigns: [],
    entered: false
  };
}

function newShop() {
  return { id: uid(), name: "", amount: "", tax: 10 };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blankStore();
    const data = JSON.parse(raw);
    const s = blankStore();
    if (Array.isArray(data.shops) && data.shops.length) {
      s.shops = data.shops.slice(0, MAX_ROWS).map((r) => ({
        id: uid(),
        name: typeof r.name === "string" ? r.name : "",
        amount: r.amount == null ? "" : String(r.amount),
        tax: r.tax === 8 ? 8 : 10
      }));
    }
    if (Array.isArray(data.campaigns)) {
      s.campaigns = data.campaigns.slice(0, MAX_ROWS).map((c) => ({
        id: uid(),
        name: typeof c.name === "string" ? c.name : "",
        rate: c.rate == null ? "" : String(c.rate),
        cap: c.cap == null ? "" : String(c.cap)
      }));
    }
    if (data.spuRate != null) s.spuRate = String(data.spuRate);
    if (data.spuCap != null) s.spuCap = String(data.spuCap);
    if (data.kaimawariCap != null) s.kaimawariCap = String(data.kaimawariCap);
    s.entered = !!data.entered;
    return s;
  } catch (e) {
    return blankStore();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    /* プライベートモードなどで保存できなくても、計算はそのまま使える */
  }
}

// ===== 計算 =====
// 数字として読めないもの（空欄・記号）は 0 として扱う。
function num(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 上限の欄は「空欄＝上限なし」。0 と空欄を区別したいので null を返す。
function cap(v) {
  const s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function applyCap(value, limit) {
  if (limit == null || value <= limit) return { value, cut: 0 };
  return { value: limit, cut: value - limit };
}

// list … { name, amount, tax } の配列。次の1ショップの試算でも同じ関数を使う。
function computeFrom(list, opt) {
  const rows = list.map((s, i) => {
    const incl = Math.floor(num(s.amount));
    const taxRate = s.tax === 8 ? 0.08 : 0.1;
    // 楽天のポイントは税抜き価格が基準。税込で入れた金額をここで戻す。
    const base = Math.floor(incl / (1 + taxRate));
    return {
      index: i,
      id: s.id,
      incl,
      base,
      unit: Math.floor(base / 100), // 1倍あたりのポイント
      groupKey: s.name && s.name.trim() ? "name:" + s.name.trim() : "row:" + i
    };
  });

  // 同じショップ名の行は合算して 1ショップ として数える。
  const groups = new Map();
  rows.forEach((r) => {
    let g = groups.get(r.groupKey);
    if (!g) {
      g = { total: 0, rows: [], count: 0 };
      groups.set(r.groupKey, g);
    }
    g.total += r.incl;
    g.count += 1;
    g.rows.push(r);
  });
  groups.forEach((g) => {
    g.eligible = g.total >= SHOP_MIN;
  });

  const shopCount = [...groups.values()].filter((g) => g.eligible).length;
  const mult = Math.min(shopCount, MAX_SHOPS);
  const bonusRate = Math.max(mult - 1, 0);

  let unitsAll = 0;      // ぜんぶの注文の 1倍分
  let unitsEligible = 0; // 買いまわり対象ショップの 1倍分
  rows.forEach((r) => {
    unitsAll += r.unit;
    if (groups.get(r.groupKey).eligible) unitsEligible += r.unit;
  });

  const lines = [];
  lines.push({ label: "通常ポイント", rate: "1倍", point: unitsAll });

  // 買いまわり分は、対象ショップの買い物にだけ (ショップ数 - 1) 倍が乗る。
  const kaimawari = applyCap(unitsEligible * bonusRate, opt.kaimawariCap);
  lines.push({
    label: "ショップ買いまわり",
    rate: "＋" + bonusRate + "倍",
    point: kaimawari.value,
    cut: kaimawari.cut,
    capLabel: opt.kaimawariCap
  });

  // SPU とキャンペーンは注文ごとに切り捨ててから足す（実際の付与に近いのはこちら）。
  const perOrder = (rate) => rows.reduce((sum, r) => sum + Math.floor(r.unit * rate), 0);

  if (opt.spuRate > 0) {
    const spu = applyCap(perOrder(opt.spuRate), opt.spuCap);
    lines.push({
      label: "SPU",
      rate: "＋" + opt.spuRate + "倍",
      point: spu.value,
      cut: spu.cut,
      capLabel: opt.spuCap
    });
  }

  opt.campaigns.forEach((c) => {
    if (c.rate <= 0) return;
    const got = applyCap(perOrder(c.rate), c.cap);
    lines.push({
      label: c.name || "キャンペーン",
      rate: "＋" + c.rate + "倍",
      point: got.value,
      cut: got.cut,
      capLabel: c.cap
    });
  });

  const total = lines.reduce((sum, l) => sum + l.point, 0);
  const pay = rows.reduce((sum, r) => sum + r.incl, 0);

  return { rows, groups, shopCount, mult, bonusRate, lines, total, pay };
}

function options() {
  return {
    kaimawariCap: cap(store.kaimawariCap),
    spuRate: num(store.spuRate),
    spuCap: cap(store.spuCap),
    campaigns: store.campaigns.map((c) => ({
      name: c.name,
      rate: num(c.rate),
      cap: cap(c.cap)
    }))
  };
}

// ===== ショップ行 =====
function renderShops() {
  const list = $("shop-list");
  list.textContent = "";
  rowRefs = new Map();

  store.shops.forEach((shop, i) => {
    const row = document.createElement("div");
    row.className = "shop-row";
    row.innerHTML =
      '<div class="shop-row-head">' +
      '  <span class="shop-no">' + (i + 1) + "</span>" +
      '  <input type="text" class="shop-name" maxlength="20" placeholder="ショップ名（任意）">' +
      '  <button type="button" class="row-del" aria-label="この行を消す">✕</button>' +
      "</div>" +
      '<div class="shop-row-body">' +
      '  <div class="amount-field">' +
      '    <input type="number" class="shop-amount" inputmode="numeric" min="0" step="1" placeholder="0">' +
      '    <span class="amount-unit">円</span>' +
      "  </div>" +
      '  <div class="tax-toggle">' +
      '    <button type="button" class="tax-btn" data-tax="10">税込10%</button>' +
      '    <button type="button" class="tax-btn" data-tax="8">税込8%</button>' +
      "  </div>" +
      "</div>" +
      '<p class="row-note"></p>';

    const nameInput = row.querySelector(".shop-name");
    const amountInput = row.querySelector(".shop-amount");
    nameInput.value = shop.name;
    amountInput.value = shop.amount;

    nameInput.addEventListener("input", () => {
      shop.name = nameInput.value;
      save();
      refresh();
    });
    amountInput.addEventListener("input", () => {
      shop.amount = amountInput.value;
      save();
      refresh();
    });

    row.querySelectorAll(".tax-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        shop.tax = Number(btn.dataset.tax);
        save();
        refresh();
      });
    });

    row.querySelector(".row-del").addEventListener("click", () => {
      store.shops = store.shops.filter((s) => s.id !== shop.id);
      if (!store.shops.length) store.shops.push(newShop());
      save();
      renderShops();
      refresh();
    });

    rowRefs.set(shop.id, {
      row,
      note: row.querySelector(".row-note"),
      taxBtns: row.querySelectorAll(".tax-btn")
    });
    list.appendChild(row);
  });

  $("btn-add-shop").disabled = store.shops.length >= MAX_ROWS;
}

// ===== キャンペーン行 =====
function renderCampaigns() {
  const list = $("campaign-list");
  list.textContent = "";

  store.campaigns.forEach((c) => {
    const row = document.createElement("div");
    row.className = "campaign-row";
    row.innerHTML =
      '<div class="campaign-head">' +
      '  <input type="text" class="campaign-name" maxlength="16" placeholder="キャンペーン名">' +
      '  <button type="button" class="row-del" aria-label="この行を消す">✕</button>' +
      "</div>" +
      '<div class="campaign-body">' +
      '  <span class="prefix">＋</span>' +
      '  <input type="number" class="num-input campaign-rate" inputmode="decimal" step="0.5" min="0" placeholder="0">' +
      '  <span class="suffix">倍</span>' +
      '  <input type="number" class="num-input campaign-cap" inputmode="numeric" min="0" placeholder="上限なし">' +
      '  <span class="suffix">P</span>' +
      "</div>";

    const nameInput = row.querySelector(".campaign-name");
    const rateInput = row.querySelector(".campaign-rate");
    const capInput = row.querySelector(".campaign-cap");
    nameInput.value = c.name;
    rateInput.value = c.rate;
    capInput.value = c.cap;

    const bind = (input, key) =>
      input.addEventListener("input", () => {
        c[key] = input.value;
        save();
        refresh();
      });
    bind(nameInput, "name");
    bind(rateInput, "rate");
    bind(capInput, "cap");

    row.querySelector(".row-del").addEventListener("click", () => {
      store.campaigns = store.campaigns.filter((x) => x.id !== c.id);
      save();
      renderCampaigns();
      refresh();
    });

    list.appendChild(row);
  });
}

// ===== 画面の書きかえ =====
function refresh() {
  const opt = options();
  const result = computeFrom(store.shops, opt);

  // 倍率とショップ数
  $("mult-value").textContent = result.mult || 1;
  $("shop-count").textContent = result.shopCount;

  const steps = $("steps");
  steps.textContent = "";
  for (let i = 1; i <= MAX_SHOPS; i++) {
    const step = document.createElement("span");
    step.className = "step" + (i <= result.mult ? " on" : "");
    steps.appendChild(step);
  }

  // 行ごとの状態（対象か、あといくらか、合算されているか）
  store.shops.forEach((shop, i) => {
    const ref = rowRefs.get(shop.id);
    if (!ref) return;
    const row = result.rows[i];
    const group = result.groups.get(row.groupKey);

    ref.taxBtns.forEach((btn) => {
      btn.classList.toggle("on", Number(btn.dataset.tax) === shop.tax);
    });

    ref.row.classList.toggle("eligible", group.eligible);
    ref.row.classList.toggle("empty", row.incl === 0);

    const parts = [];
    if (row.incl === 0) {
      parts.push("金額を入れてね");
    } else if (group.eligible) {
      parts.push("買いまわり対象 ／ 税抜 " + fmt(row.base) + "円 → 1倍で " + fmt(row.unit) + "P");
    } else {
      parts.push("あと " + fmt(SHOP_MIN - group.total) + "円で買いまわり対象");
    }
    if (group.count > 1) parts.push("同じショップ名の " + group.count + "行を合算");
    ref.note.textContent = parts.join(" ／ ");
  });

  // 次の1ショップでどれだけ増えるか
  const hint = $("next-hint");
  if (result.shopCount >= MAX_SHOPS) {
    hint.textContent = "10ショップ達成。これ以上ショップを増やしても倍率は上がりません。";
    hint.className = "next-hint done";
  } else {
    const sim = computeFrom(
      store.shops.concat([{ id: "sim", name: "", amount: String(SHOP_MIN), tax: 10 }]),
      opt
    );
    const delta = sim.total - result.total;
    const net = SHOP_MIN - delta;
    let text = "あと1ショップ（税込1,000円）増やすと ＋" + fmt(delta) + "P。";
    text +=
      net > 0
        ? "1,000円の買い物が、実質 " + fmt(net) + "円になります。"
        : "1,000円の買い物で、ポイントのほうが " + fmt(-net) + "円ぶん多くなります。";
    hint.textContent = text;
    hint.className = "next-hint";
  }

  // 内訳
  const body = $("breakdown-body");
  body.textContent = "";
  result.lines.forEach((line) => {
    const tr = document.createElement("tr");
    if (line.point === 0) tr.className = "zero";
    tr.innerHTML =
      '<td class="bd-label">' + escapeHtml(line.label) + "</td>" +
      '<td class="bd-rate">' + escapeHtml(line.rate) + "</td>" +
      '<td class="bd-point">' + fmt(line.point) + "<span>P</span></td>";
    body.appendChild(tr);
  });
  const totalRow = document.createElement("tr");
  totalRow.className = "bd-total";
  totalRow.innerHTML =
    '<td class="bd-label">合計</td><td class="bd-rate"></td>' +
    '<td class="bd-point">' + fmt(result.total) + "<span>P</span></td>";
  body.appendChild(totalRow);

  // 上限で削られた分の注意
  const notes = $("cap-notes");
  notes.textContent = "";
  result.lines.forEach((line) => {
    if (!line.cut) return;
    const p = document.createElement("p");
    p.className = "cap-note";
    p.textContent =
      line.label + " は上限 " + fmt(line.capLabel) + "P にかかっていて、" +
      fmt(line.cut) + "P 分は付きません。";
    notes.appendChild(p);
  });

  const back = result.pay > 0 ? (result.total / result.pay) * 100 : 0;
  $("total-point").textContent = fmt(result.total);
  $("total-sub").textContent =
    "支払い " + fmt(result.pay) + "円 ／ 還元率 " + back.toFixed(1) + "%";

  // 下に貼りつくバー
  $("sticky-point").textContent = fmt(result.total);
  $("sticky-mult").textContent = (result.mult || 1) + "倍";
  $("sticky-pay").textContent = fmt(result.pay) + "円";

  $("entry-warn").hidden = store.entered;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ===== 起動 =====
function init() {
  store = load();

  $("spu-rate").value = store.spuRate;
  $("spu-cap").value = store.spuCap;
  $("kaimawari-cap").value = store.kaimawariCap;
  $("entry-check").checked = store.entered;

  const bindSetting = (id, key) =>
    $(id).addEventListener("input", () => {
      store[key] = $(id).value;
      save();
      refresh();
    });
  bindSetting("spu-rate", "spuRate");
  bindSetting("spu-cap", "spuCap");
  bindSetting("kaimawari-cap", "kaimawariCap");

  $("entry-check").addEventListener("change", () => {
    store.entered = $("entry-check").checked;
    save();
    refresh();
  });

  $("btn-add-shop").addEventListener("click", () => {
    if (store.shops.length >= MAX_ROWS) return;
    store.shops.push(newShop());
    save();
    renderShops();
    refresh();
    const rows = $("shop-list").querySelectorAll(".shop-row");
    const last = rows[rows.length - 1];
    if (last) last.querySelector(".shop-amount").focus();
  });

  $("preset-row").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    if (store.campaigns.length >= MAX_ROWS) return;
    store.campaigns.push({ id: uid(), name: btn.dataset.preset || "", rate: "1", cap: "" });
    save();
    renderCampaigns();
    refresh();
  });

  $("btn-clear").addEventListener("click", () => {
    if (!confirm("入力した内容をぜんぶ消します。よろしいですか？")) return;
    store = blankStore();
    save();
    $("spu-rate").value = store.spuRate;
    $("spu-cap").value = store.spuCap;
    $("kaimawari-cap").value = store.kaimawariCap;
    $("entry-check").checked = store.entered;
    renderShops();
    renderCampaigns();
    refresh();
  });

  $("stickybar").addEventListener("click", () => {
    $("result-card").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  renderShops();
  renderCampaigns();
  refresh();
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
