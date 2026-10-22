// CSV の読み書き。列は「英語, 日本語訳, 種類, 例文」の順。
// Windows の Excel でそのまま開けるよう、書き出しは BOM つき UTF-8・CRLF にする。
const CSV_HEADER = ["英語", "日本語訳", "種類", "例文"];

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function csvField(s) {
  s = String(s ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows) {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// Excel の「CSV（コンマ区切り）」で保存すると Shift_JIS になる。
// UTF-8 として読めなければ Shift_JIS として読み直す。
function decodeCSVBytes(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch (e) {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

function parseType(s, en) {
  const t = (s || "").trim().toLowerCase();
  if (["熟語", "じゅくご", "idiom", "phrase", "熟", "2"].includes(t)) return "idiom";
  if (["単語", "たんご", "word", "単", "1"].includes(t)) return "word";
  // 空欄のときは、スペースが入っていれば熟語とみなす
  return /\s/.test(en.trim()) ? "idiom" : "word";
}

function isHeaderRow(r) {
  const first = (r[0] || "").trim().toLowerCase();
  return first === "英語" || first === "english" || first === "en";
}

// 読み込んだ行を単語帳に入れる。同じ英語がすでにあれば訳などを上書きし、
// これまでの学習の進み具合はそのまま残す。
function importCSVText(text) {
  const rows = parseCSV(text);
  // 知らせる行番号はファイルの中の行（空行は数えない）にそろえる
  let lineOffset = 1;
  if (rows.length && isHeaderRow(rows[0])) {
    rows.shift();
    lineOffset = 2;
  }
  const result = { added: 0, updated: 0, skipped: [] };
  rows.forEach((r, i) => {
    const en = (r[0] || "").trim();
    const ja = (r[1] || "").trim();
    if (!en || !ja) {
      result.skipped.push(i + lineOffset);
      return;
    }
    const type = parseType(r[2], en);
    const example = (r[3] || "").trim();
    const found = findWordByEn(en, null);
    if (found) {
      // 例文の欄が空なら、登録ずみの例文は消さずに残す
      Object.assign(found, { en, ja, type, example: example || found.example });
      result.updated++;
    } else {
      db.words.push(makeWord(en, ja, type, example));
      result.added++;
    }
  });
  saveDB();
  return result;
}

function exportCSVText() {
  const rows = [CSV_HEADER];
  const words = db.words.slice().sort((a, b) => a.createdAt - b.createdAt);
  for (const w of words) rows.push([w.en, w.ja, TYPE_LABEL[w.type], w.example]);
  return "﻿" + toCSV(rows);
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
