// 端末に入っている英語音声で読み上げる（Web Speech API）。通信も料金もかからない。
const Speech = {
  supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  voices: [],

  init() {
    if (!this.supported) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    };
    load();
    // Chrome は声の一覧があとから届く
    speechSynthesis.addEventListener("voiceschanged", load);
  },

  pickVoice(preferredURI) {
    if (preferredURI) {
      const v = this.voices.find((x) => x.voiceURI === preferredURI);
      if (v) return v;
    }
    const us = this.voices.filter((v) => /^en[-_]US/i.test(v.lang));
    // 通信が要らない端末内の声を先に使う
    return us.find((v) => v.localService) || us[0] || this.voices.find((v) => v.localService) || this.voices[0] || null;
  },

  speak(text, opts = {}) {
    if (!this.supported || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = this.pickVoice(opts.voiceURI);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : "en-US";
    u.rate = opts.rate || 0.9;
    speechSynthesis.speak(u);
  },

  stop() {
    if (this.supported) speechSynthesis.cancel();
  },
};

Speech.init();
