// 書いた答えの採点と、4択の選択肢づくり。画面には触れない。

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 採点のときに気にしない差をならす。
// 全角の英字（日本語入力のまま打ったもの）、大文字小文字、’ と '、
// ～ や ...、文末の . ? ! 、空白の数は同じものとみなす。
function normAnswer(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[～~〜]/g, " ")
    .replace(/\.\.\.|…/g, " ")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 正解として受けつける形。
//   "color / colour" … どちらでも正解
//   "(be) afraid of" … かっこの中はあってもなくても正解
function acceptedAnswers(en) {
  const out = new Set();
  for (const part of en.split("/")) {
    out.add(normAnswer(part.replace(/[()]/g, "")));
    out.add(normAnswer(part.replace(/\([^)]*\)/g, "")));
  }
  out.delete("");
  return out;
}

function isCorrectAnswer(input, en) {
  const a = normAnswer(input);
  return a !== "" && acceptedAnswers(en).has(a);
}

// 頭文字だけ見せるヒント。"look for" → "l _ _ _   f _ _"
function hintFor(en) {
  const main = en.split("/")[0].replace(/[()]/g, "").trim();
  return main
    .split(/\s+/)
    .map((word) => [...word].map((c, i) => (i === 0 || !/[a-z]/i.test(c) ? c : "_")).join(" "))
    .join("　 ");
}

// 正解 1 つ + まぎらわしい訳 3 つ。同じ種類（単語なら単語）から先に選ぶ。
function makeChoices(word, allWords, n = 4) {
  const others = allWords.filter((w) => w.id !== word.id);
  const sameType = shuffle(others.filter((w) => w.type === word.type));
  const otherType = shuffle(others.filter((w) => w.type !== word.type));
  const picked = [];
  const seen = new Set([word.ja]);
  for (const w of [...sameType, ...otherType]) {
    if (picked.length >= n - 1) break;
    if (seen.has(w.ja)) continue;
    seen.add(w.ja);
    picked.push(w);
  }
  return shuffle([word, ...picked]);
}
