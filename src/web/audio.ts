// Small WebAudio player with an ocarina-like tone (sine + a touch of breath and vibrato).

export interface PlayNote {
  index: number;
  pitch: number | null;
  start: number; // beats
  duration: number; // beats
}

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private raf = 0;
  private startTime = 0;
  playing = false;

  async play(notes: PlayNote[], tempo: number, onNote: (index: number | null) => void, onEnd: () => void, fromBeat = 0) {
    this.stop();
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;
    const secPerBeat = 60 / tempo;
    this.master = ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.08;
    this.startTime = t0 - fromBeat * secPerBeat;
    const playable = notes.filter((n) => n.start + n.duration > fromBeat);

    for (const n of playable) {
      if (n.pitch === null) continue;
      const s = this.startTime + n.start * secPerBeat;
      const len = Math.max(0.05, n.duration * secPerBeat);
      const e = s + len;
      if (e < t0) continue;
      const freq = 440 * 2 ** ((n.pitch - 69) / 12);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = freq;
      const g2 = ctx.createGain();
      g2.gain.value = 0.08;
      // vibrato
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.004;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const env = ctx.createGain();
      const start = Math.max(s, t0);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.025);
      env.gain.setValueAtTime(1, Math.max(start + 0.03, e - 0.05));
      env.gain.linearRampToValueAtTime(0, e);
      osc.connect(env);
      o2.connect(g2).connect(env);
      env.connect(this.master);
      for (const node of [osc, o2, lfo]) {
        node.start(start);
        node.stop(e + 0.02);
        this.nodes.push(node);
      }
    }

    this.playing = true;
    const end = Math.max(...playable.map((n) => n.start + n.duration), fromBeat);
    let last: number | null = -1;
    const tick = () => {
      if (!this.playing || !this.ctx) return;
      const beat = (this.ctx.currentTime - this.startTime) / secPerBeat;
      if (beat >= end) {
        onNote(null);
        this.playing = false;
        onEnd();
        return;
      }
      const cur = playable.find((n) => beat >= n.start && beat < n.start + n.duration);
      const idx = cur ? cur.index : null;
      if (idx !== last) {
        last = idx;
        onNote(idx);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Short preview of a single pitch (when a note is tapped). */
  async preview(pitch: number) {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.22, t + 0.02);
    env.gain.linearRampToValueAtTime(0, t + 0.45);
    osc.connect(env).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
    this.master?.disconnect();
    this.master = null;
  }
}
