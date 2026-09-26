// Voice notes: what you say into the microphone while you play, transcribed
// by the browser (Chrome's Web Speech API) on the gaming PC, with the times
// each sentence started and ended. Chrome stops listening now and then; this
// starts it again until told to stop.

export class VoiceNotes {
  // onNote({ id, start, end, text }) with local ms; onState('listening' | 'off' | 'error: …').
  constructor({ onNote, onState = () => {}, lang = 'en-US', now = () => Date.now() } = {}) {
    Object.assign(this, { onNote, onState, lang, now });
    this.running = false;
    this.rec = null;
    this.utteranceStart = null;
    this.n = 0;
  }

  static supported() {
    return typeof globalThis.webkitSpeechRecognition === 'function' || typeof globalThis.SpeechRecognition === 'function';
  }

  start() {
    if (this.running) return;
    const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Ctor) { this.onState('error: this browser cannot transcribe speech (use Chrome)'); return; }
    this.running = true;
    const rec = new Ctor();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.onstart = () => this.onState('listening');
    rec.onresult = (ev) => this.onResult(ev);
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      this.onState(`error: ${ev.error}`);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') this.running = false;
    };
    rec.onend = () => {
      this.utteranceStart = null;
      if (this.running) setTimeout(() => { try { rec.start(); } catch { /* already started */ } }, 300);
      else this.onState('off');
    };
    try { rec.start(); } catch (err) { this.onState(`error: ${err.message}`); }
  }

  stop() {
    this.running = false;
    try { this.rec?.stop(); } catch { /* not started */ }
    this.rec = null;
    this.onState('off');
  }

  // The API gives no times, so a sentence starts when its first partial
  // result shows up and ends when the final one does.
  onResult(ev) {
    const t = this.now();
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r.isFinal) { this.utteranceStart ??= t; continue; }
      const text = String(r[0]?.transcript ?? '').trim();
      const start = this.utteranceStart ?? t - Math.min(8000, 400 * text.split(/\s+/).length);
      this.utteranceStart = null;
      if (!text) continue;
      this.n++;
      this.onNote({ id: `v${t}-${this.n}`, start, end: t, text });
    }
  }
}
