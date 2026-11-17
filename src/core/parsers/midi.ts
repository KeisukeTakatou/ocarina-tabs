// Minimal Standard MIDI File (SMF type 0/1) reader. No dependencies.

import { NoteEvent, Score, toMonophonic } from '../score.ts';

export interface MidiNote {
  pitch: number;
  start: number; // ticks
  duration: number; // ticks
  velocity: number;
  channel: number;
}

export interface MidiTrack {
  index: number;
  name: string;
  notes: MidiNote[];
  channels: number[];
}

export interface MidiFile {
  format: number;
  ppq: number;
  tracks: MidiTrack[];
  tempos: { tick: number; bpm: number }[];
  timeSignatures: { tick: number; num: number; den: number }[];
  keySignatures: { tick: number; fifths: number; minor: boolean }[];
}

class Reader {
  pos = 0;
  constructor(public data: Uint8Array) {}
  u8() {
    if (this.pos >= this.data.length) throw new Error('Unexpected end of MIDI data');
    return this.data[this.pos++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    return v;
  }
}

export function isMidi(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x4d && data[1] === 0x54 && data[2] === 0x68 && data[3] === 0x64;
}

export function parseMidi(data: Uint8Array): MidiFile {
  const r = new Reader(data);
  // Skip an optional RIFF wrapper (.rmi)
  if (r.str(4) !== 'MThd') {
    const idx = findBytes(data, [0x4d, 0x54, 0x68, 0x64]);
    if (idx < 0) throw new Error('Not a MIDI file (missing MThd header)');
    r.pos = idx + 4;
  }
  const hlen = r.u32();
  const format = r.u16();
  const ntrks = r.u16();
  const division = r.u16();
  r.pos += hlen - 6;
  const ppq = division & 0x8000 ? 480 : division || 480;

  const file: MidiFile = { format, ppq, tracks: [], tempos: [], timeSignatures: [], keySignatures: [] };

  for (let t = 0; t < ntrks && r.pos < data.length - 8; t++) {
    const id = r.str(4);
    const len = r.u32();
    const end = Math.min(r.pos + len, data.length);
    if (id !== 'MTrk') {
      r.pos = end;
      t--;
      continue;
    }
    const track: MidiTrack = { index: file.tracks.length, name: '', notes: [], channels: [] };
    const open = new Map<number, { start: number; velocity: number }[]>();
    const chans = new Set<number>();
    let tick = 0;
    let running = 0;
    try {
      while (r.pos < end) {
        tick += r.vlq();
        let status = r.data[r.pos];
        if (status & 0x80) r.pos++;
        else status = running;
        if (status === 0xff) {
          const type = r.u8();
          const l = r.vlq();
          const start = r.pos;
          if (type === 0x03 && !track.name) track.name = decodeText(data.subarray(start, start + l));
          else if (type === 0x51 && l >= 3) {
            const us = (data[start] << 16) | (data[start + 1] << 8) | data[start + 2];
            if (us > 0) file.tempos.push({ tick, bpm: 60_000_000 / us });
          } else if (type === 0x58 && l >= 2) {
            file.timeSignatures.push({ tick, num: data[start], den: 2 ** data[start + 1] });
          } else if (type === 0x59 && l >= 2) {
            const sf = data[start] > 127 ? data[start] - 256 : data[start];
            file.keySignatures.push({ tick, fifths: sf, minor: data[start + 1] === 1 });
          } else if (type === 0x2f) {
            r.pos = start + l;
            break;
          }
          r.pos = start + l;
        } else if (status === 0xf0 || status === 0xf7) {
          r.pos += r.vlq();
        } else {
          running = status;
          const kind = status & 0xf0;
          const ch = status & 0x0f;
          if (kind === 0x80 || kind === 0x90) {
            const pitch = r.u8();
            const vel = r.u8();
            const k = ch * 128 + pitch;
            if (kind === 0x90 && vel > 0) {
              const list = open.get(k) ?? [];
              list.push({ start: tick, velocity: vel });
              open.set(k, list);
            } else {
              const list = open.get(k);
              const on = list?.shift();
              if (on && tick > on.start) {
                track.notes.push({ pitch, start: on.start, duration: tick - on.start, velocity: on.velocity, channel: ch });
                chans.add(ch);
              }
            }
          } else if (kind === 0xc0 || kind === 0xd0) r.pos += 1;
          else r.pos += 2;
        }
      }
    } catch {
      // Truncated track: keep what we have.
    }
    r.pos = end;
    track.notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
    track.channels = [...chans].sort((a, b) => a - b);
    file.tracks.push(track);
  }
  return file;
}

function findBytes(data: Uint8Array, pat: number[]): number {
  outer: for (let i = 0; i < data.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (data[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

function decodeText(b: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(b).replace(/\0/g, '').trim();
  } catch {
    return String.fromCharCode(...b);
  }
}

export interface MidiTrackInfo {
  index: number;
  name: string;
  notes: number;
  channels: number[];
  lowest: number | null;
  highest: number | null;
  drums: boolean;
}

export function describeMidiTracks(midi: MidiFile): MidiTrackInfo[] {
  return midi.tracks
    .filter((t) => t.notes.length)
    .map((t) => ({
      index: t.index,
      name: t.name || `Track ${t.index + 1}`,
      notes: t.notes.length,
      channels: t.channels,
      lowest: Math.min(...t.notes.map((n) => n.pitch)),
      highest: Math.max(...t.notes.map((n) => n.pitch)),
      drums: t.channels.length > 0 && t.channels.every((c) => c === 9),
    }));
}

/**
 * Pick the most likely melody track: non-drum, reasonably many notes,
 * highest average pitch (melodies usually sit on top).
 */
export function guessMelodyTrack(midi: MidiFile): number {
  const cands = midi.tracks.filter((t) => t.notes.length && !t.channels.every((c) => c === 9));
  if (!cands.length) return midi.tracks.findIndex((t) => t.notes.length);
  const maxNotes = Math.max(...cands.map((t) => t.notes.length));
  let best = cands[0];
  let bestScore = -Infinity;
  for (const t of cands) {
    const nonDrum = t.notes.filter((n) => n.channel !== 9);
    if (nonDrum.length < maxNotes * 0.25) continue;
    const avg = nonDrum.reduce((s, n) => s + n.pitch, 0) / nonDrum.length;
    // Penalise chordal tracks (many simultaneous onsets).
    const onsets = new Set(nonDrum.map((n) => n.start)).size;
    const poly = nonDrum.length / Math.max(1, onsets);
    const score = avg - (poly - 1) * 8 + (/melod|lead|vocal|voice|flute|ocarina|solo/i.test(t.name) ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best.index;
}

export interface MidiToScoreOptions {
  /** Track index, or "auto" to guess the melody. Use "all" to merge every non-drum track. */
  track?: number | 'auto' | 'all';
  /** Only use notes from this MIDI channel (0-15). */
  channel?: number;
  /** Quantize grid in beats (default 1/12 — covers 16ths and triplet 8ths). 0 disables. */
  quantize?: number;
  title?: string;
}

export function midiToScore(midi: MidiFile, opts: MidiToScoreOptions = {}): Score {
  const warnings: string[] = [];
  const sel = opts.track ?? 'auto';
  let raw: MidiNote[];
  if (sel === 'all') raw = midi.tracks.flatMap((t) => t.notes).filter((n) => n.channel !== 9);
  else {
    const idx = sel === 'auto' ? guessMelodyTrack(midi) : sel;
    const track = midi.tracks[idx];
    if (!track) throw new Error(`MIDI track ${idx} not found (file has ${midi.tracks.length} tracks)`);
    raw = track.notes.filter((n) => n.channel !== 9 || track.channels.every((c) => c === 9));
    if (sel === 'auto' && midi.tracks.filter((t) => t.notes.length).length > 1)
      warnings.push(`Using MIDI track ${idx} ("${track.name || `Track ${idx + 1}`}") as the melody; another track can be chosen.`);
  }
  if (opts.channel !== undefined) raw = raw.filter((n) => n.channel === opts.channel);

  const q = opts.quantize ?? 1 / 12;
  const snap = (x: number) => (q > 0 ? Math.round(x / q) * q : x);
  const notes: NoteEvent[] = raw
    .map((n) => {
      const start = snap(n.start / midi.ppq);
      const end = snap((n.start + n.duration) / midi.ppq);
      return { pitch: n.pitch, start, duration: Math.max(end - start, q || 0.01) };
    })
    .filter((n) => n.duration > 0);

  const ts = midi.timeSignatures[0];
  const ks = midi.keySignatures[0];
  const firstNameTrack = midi.tracks.find((t) => t.name);
  return {
    title: opts.title ?? (midi.format === 1 ? midi.tracks[0]?.name : undefined) ?? firstNameTrack?.name,
    tempo: Math.round(midi.tempos[0]?.bpm ?? 120),
    timeSignature: ts ? [ts.num, ts.den] : [4, 4],
    keyFifths: ks?.fifths,
    notes: toMonophonic(notes, warnings),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Writer (used to export the arranged melody so it can be checked by ear / in other tools)

export function writeMidi(notes: { pitch: number | null; start: number; duration: number }[], opts: { tempo?: number; ppq?: number; program?: number; timeSignature?: [number, number] } = {}): Uint8Array {
  const ppq = opts.ppq ?? 480;
  const evs: { tick: number; bytes: number[] }[] = [];
  const us = Math.round(60_000_000 / (opts.tempo ?? 120));
  evs.push({ tick: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  const [num, den] = opts.timeSignature ?? [4, 4];
  evs.push({ tick: 0, bytes: [0xff, 0x58, 4, num, Math.round(Math.log2(den)), 24, 8] });
  evs.push({ tick: 0, bytes: [0xc0, opts.program ?? 79] }); // 79 = Ocarina in General MIDI (0-based)
  for (const n of notes) {
    if (n.pitch === null) continue;
    const a = Math.round(n.start * ppq);
    const b = Math.max(a + 1, Math.round((n.start + n.duration) * ppq));
    evs.push({ tick: a, bytes: [0x90, n.pitch, 90] });
    evs.push({ tick: b, bytes: [0x80, n.pitch, 0] });
  }
  evs.sort((x, y) => x.tick - y.tick || (x.bytes[0] === 0x80 ? -1 : 0) - (y.bytes[0] === 0x80 ? -1 : 0));
  const body: number[] = [];
  let last = 0;
  for (const e of evs) {
    pushVlq(body, e.tick - last);
    last = e.tick;
    body.push(...e.bytes);
  }
  body.push(0, 0xff, 0x2f, 0);
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255, 0x4d, 0x54, 0x72, 0x6b];
  const len = body.length;
  out.push((len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...body);
  return new Uint8Array(out);
}

function pushVlq(out: number[], v: number) {
  const stack = [v & 0x7f];
  while ((v >>= 7)) stack.unshift((v & 0x7f) | 0x80);
  out.push(...stack);
}
