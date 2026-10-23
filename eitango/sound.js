// 正解のピンポンと不正解のブブー。さんすうトレーニングと同じ音を使う。
//
// mp3 を Audio 要素で鳴らすと、スマホでは押してから音が出るまでにもたつくことがある。
// あらかじめ読みこんでおき Web Audio で鳴らす。読みこめなかったときは
// Audio 要素 →（それも駄目なら）合成音、の順にさかのぼる。
const Sfx = {
  ctx: null,
  buffers: {},
  audios: {},
  current: null,
  loading: false,
  // 音が鳴っている長さ（秒）。このあとに英語を読み上げると重ならない
  LENGTH: 0.75,

  context() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  // スマホは画面に触れたあとでないと音を出せないので、最初のタップで読みこむ
  preload() {
    if (this.loading) return;
    this.loading = true;
    const ctx = this.context();
    if (!ctx) return;
    for (const key of ["correct", "wrong"]) {
      fetch(`sounds/${key}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((data) => new Promise((ok, ng) => ctx.decodeAudioData(data, ok, ng)))
        .then((buffer) => (this.buffers[key] = buffer))
        .catch(() => {
          // 読みこめなくても Audio 要素で鳴らせるので、そのまま続ける
        });
    }
  },

  playBuffer(key) {
    const buffer = this.buffers[key];
    const ctx = buffer && this.context();
    if (!ctx) return false;
    // 前の音が残っていたら止めてから鳴らす（続けて答えたときに音が重ならない）
    if (this.current) {
      try {
        this.current.stop();
      } catch (e) {
        // もう止まっていた
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    this.current = source;
    return true;
  },

  tone(freq, start, duration, type, peak) {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  },

  synth(key) {
    if (key === "correct") {
      this.tone(880, 0, 0.15, "sine", 0.25); // ピン
      this.tone(659, 0.15, 0.3, "sine", 0.25); // ポーン
    } else {
      this.tone(180, 0, 0.18, "sawtooth", 0.2); // ブッ
      this.tone(160, 0.22, 0.3, "sawtooth", 0.2); // ブー
    }
  },

  play(key) {
    if (!db.settings.sfx) return false;
    if (!this.playBuffer(key)) {
      if (!this.audios[key]) {
        this.audios[key] = new Audio(`sounds/${key}.mp3`);
        this.audios[key].preload = "auto";
      }
      const a = this.audios[key];
      a.currentTime = 0;
      a.play().catch(() => this.synth(key));
    }
    return true;
  },
};

document.addEventListener("pointerdown", () => Sfx.preload(), { once: true, capture: true });
