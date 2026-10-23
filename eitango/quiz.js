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
// ～ や ...、文末の . ? ! 、空白の数は同じものとみなす。「be動詞」は be と読む。
function normAnswer(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/be\s*動詞/g, "be ")
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
//   "be good at"     … be動詞を am / is / are / was / were にして書いても正解
function acceptedAnswers(en) {
  const out = new Set();
  for (const part of en.split("/")) {
    out.add(normAnswer(part.replace(/[()]/g, "")));
    out.add(normAnswer(part.replace(/\([^)]*\)/g, "")));
  }
  for (const a of [...out]) {
    if (!a.startsWith("be ")) continue;
    for (const be of ["am", "is", "are", "was", "were"]) out.add(be + a.slice(2));
  }
  out.delete("");
  return out;
}

function isCorrectAnswer(input, en) {
  const a = normAnswer(input);
  return a !== "" && acceptedAnswers(en).has(a);
}

// 頭文字だけ見せるヒント。"look for" → "l _ _ _   f _ _"
// 頭の be動詞はそのまま見せる。"be good at" → "be動詞   g _ _ _   a _"
function hintFor(en) {
  const main = en.split("/")[0].replace(/[()]/g, "").trim();
  const words = main.split(/\s+/);
  return words
    .map((word, n) =>
      n === 0 && words.length > 1 && word.toLowerCase() === "be"
        ? "be動詞"
        : [...word].map((c, i) => (i === 0 || !/[a-z]/i.test(c) ? c : "_")).join(" ")
    )
    .join("　 ");
}

// 訳を意味ごとに分ける。「大切な、重要な」→ 大切な / 重要な。
// （数えられる）のようなかっこの中は補足（note）として分けておき、～ と空白は除く。
function meaningParts(ja) {
  return ja
    .split(/[、,，/／;；・](?![^（(]*[）)])/)
    .map((s) => ({
      core: s.replace(/[（(][^）)]*[）)]/g, "").replace(/[～~〜\s]/g, ""),
      note: (s.match(/[（(]([^）)]*)[）)]/) || [])[1] || "",
    }))
    .filter((p) => p.core);
}

// 2つの訳に同じ意味が1つでもあれば true。
// 補足がちがうものは別の意味とする（many「（数えられる）たくさんの」と
// much「（数えられない）たくさんの」）。片方にしか補足がなければ同じ意味
// （a lot of「たくさんの」は many とも much とも同じ）。
function sameMeaning(a, b) {
  const pb = meaningParts(b);
  return meaningParts(a).some((x) =>
    pb.some((y) => x.core === y.core && (!x.note || !y.note || x.note === y.note))
  );
}

// 書いた答えが、同じ意味で登録されている別の単語（a lot of に対する many など）なら、その単語
function synonymAnswer(input, word, allWords) {
  return allWords.find((w) => w.id !== word.id && sameMeaning(w.ja, word.ja) && isCorrectAnswer(input, w.en)) || null;
}

// 正解 1 つ + まぎらわしい訳 3 つ。同じ種類（単語なら単語）から先に選ぶ。
// 正解と同じ意味の訳や、おたがいに同じ意味の訳は選択肢に入れない（正解が2つになるので）。
function makeChoices(word, allWords, n = 4) {
  const others = allWords.filter((w) => w.id !== word.id);
  const sameType = shuffle(others.filter((w) => w.type === word.type));
  const otherType = shuffle(others.filter((w) => w.type !== word.type));
  const picked = [];
  for (const w of [...sameType, ...otherType]) {
    if (picked.length >= n - 1) break;
    if ([word, ...picked].some((p) => sameMeaning(p.ja, w.ja))) continue;
    picked.push(w);
  }
  return shuffle([word, ...picked]);
}
