// 間隔反復。正解するたびに次に出すまでの日数をのばし、まちがえたら最初からやり直す。
//
//   レベル 0 … 今日もう一度（まちがえた・知らなかった）
//   レベル 1 → 1日後、2 → 3日後、3 → 7日後、4 → 14日後、5 → 30日後、6 → 60日後
//
// レベル 4（2週間あけても正解できた）以上を「覚えた」とする。
const INTERVALS = [0, 1, 3, 7, 14, 30, 60];
const MAX_LEVEL = INTERVALS.length - 1;
const MASTERED_LEVEL = 4;

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

// まだ一度も学習していない単語
function isNew(w) {
  return !w.due;
}

function isMastered(w) {
  return (w.level || 0) >= MASTERED_LEVEL;
}

// 苦手：一度でもまちがえて、まだ覚えたところまで来ていない単語
function isWeak(w) {
  return !isNew(w) && (w.lapses || 0) > 0 && !isMastered(w);
}

function dayLog(day) {
  if (!db.log[day]) db.log[day] = { count: 0, newCount: 0, correct: 0, wrong: 0 };
  return db.log[day];
}

// 答えを1つ記録する。firstMiss は「この回の学習で初めてまちがえた」とき true
// （同じ回で何度まちがえても、苦手の回数は1回と数える）。
function applyResult(w, correct, firstMiss) {
  const today = todayStr();
  const log = dayLog(today);
  if (w.lastDay !== today) log.count++;
  if (isNew(w)) log.newCount++;
  if (correct) log.correct++;
  else log.wrong++;

  if (correct) {
    // 予定より早く練習したときは、正解してもレベルは上げない（覚えたことにしない）
    if (isNew(w) || w.due <= today) {
      w.level = Math.min((w.level || 0) + 1, MAX_LEVEL);
      w.due = addDays(today, INTERVALS[w.level]);
    }
  } else {
    w.level = 0;
    w.due = today;
    if (firstMiss) w.lapses = (w.lapses || 0) + 1;
  }
  w.reps = (w.reps || 0) + 1;
  w.lastDay = today;
  saveDB();
}

// ホームで選んだ学年の単語か（「すべて」なら学年なしの単語も含む）
function inGrade(w) {
  const g = db.settings.gradeFilter;
  return !g || w.grade === g;
}

// 今日やる単語。まちがえた・知らなかった単語を先頭に、復習、新しい単語の順。
// ホームで学年を選んでいれば、その学年の単語だけ。
function todayQueue() {
  const today = todayStr();
  const words = db.words.filter(inGrade);
  const due = shuffle(words.filter((w) => !isNew(w) && w.due <= today)).sort(
    (a, b) => (a.level || 0) - (b.level || 0) || (b.lapses || 0) - (a.lapses || 0) || a.due.localeCompare(b.due)
  );
  const newLeft = Math.max(0, db.settings.newPerDay - dayLog(today).newCount);
  const fresh = words
    .filter(isNew)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, newLeft);
  return { review: due, fresh };
}

// 苦手な単語だけ。レベルが低く、まちがえた回数が多いものから。
function weakQueue() {
  return shuffle(db.words.filter((w) => inGrade(w) && isWeak(w))).sort(
    (a, b) => (a.level || 0) - (b.level || 0) || (b.lapses || 0) - (a.lapses || 0)
  );
}

// 今日答えた単語（カードめくりでも書く問題でも）。カードで見た単語を書いて確かめる用。
// まちがえた・知らなかった単語から。予定より早い正解ではレベルが上がらないので、
// ここで正解しても次に出る日は変わらない。
function doneTodayQueue() {
  const today = todayStr();
  return shuffle(db.words.filter((w) => inGrade(w) && w.lastDay === today)).sort(
    (a, b) => (a.level || 0) - (b.level || 0)
  );
}

// 続けて学習した日数。今日まだ学習していなければ、昨日までの日数を数える。
function streakDays() {
  let day = todayStr();
  if (!(db.log[day] && db.log[day].count > 0)) day = addDays(day, -1);
  let n = 0;
  while (db.log[day] && db.log[day].count > 0) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
