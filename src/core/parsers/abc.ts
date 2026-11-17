// ABC notation (https://abcnotation.com/wiki/abc:standard:v2.1) → Score.
// Supports the common subset used for melodies: header fields, key signatures with modes,
// accidentals, octaves, lengths, rests, chords (top note kept), ties, broken rhythm,
// tuplets, inline fields and bar lines. Repeats are read straight through.

import { letterPc } from '../pitch.ts';
import { NoteEvent, Score, toMonophonic } from '../score.ts';

const MAJOR_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
const MODE_SHIFT: Record<string, number> = {
  '': 0, maj: 0, major: 0, ion: 0, mix: -1, dor: -2, m: -3, min: -3, aeo: -3, phr: -4, loc: -5, lyd: 1,
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export function looksLikeAbc(t: string): boolean {
  return /^\s*X:\s*\d*/m.test(t) && /^\s*K:/m.test(t);
}

/** Parse "K:" value into fifths (major-key equivalent). */
export function abcKeyFifths(value: string): number {
  const v = value.trim();
  if (!v || /^none|^HP|^Hp/i.test(v)) return 0;
  const m = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(v);
  if (!m) return 0;
  const tonic = m[1] + m[2];
  const mode = m[3].toLowerCase().slice(0, 3);
  const modeKey = m[3].toLowerCase() === 'm' ? 'm' : mode;
  const shift = MODE_SHIFT[modeKey] ?? 0;
  // fifths of tonic as a major key
  const pcToFifths = (name: string): number => {
    if (MAJOR_FIFTHS[name] !== undefined) return MAJOR_FIFTHS[name];
    // enharmonic fallbacks (e.g. "A#" → Bb)
    const enh: Record<string, string> = { 'A#': 'Bb', 'D#': 'Eb', 'G#': 'Ab', Fb: 'E', 'E#': 'F', 'B#': 'C' };
    return MAJOR_FIFTHS[enh[name]] ?? 0;
  };
  let f = pcToFifths(tonic) + shift;
  if (f > 7) f -= 12;
  if (f < -7) f += 12;
  return f;
}

function keyAccidentals(fifths: number): Record<string, number> {
  const acc: Record<string, number> = {};
  if (fifths > 0) for (let i = 0; i < fifths; i++) acc[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths; i++) acc[FLAT_ORDER[i]] = -1;
  return acc;
}

function parseFraction(s: string): number {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s.trim());
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMeter(v: string): [number, number] | null {
  const t = v.trim();
  if (t === 'C') return [4, 4];
  if (t === 'C|') return [2, 2];
  const m = /^(\d+)(?:\+\d+)*\s*\/\s*(\d+)/.exec(t);
  if (!m) return null;
  const top = t.split('/')[0].split('+').reduce((s, x) => s + parseInt(x, 10), 0);
  return [top, parseInt(m[2], 10)];
}

function parseTempo(v: string): number | null {
  const s = v.replace(/"[^"]*"/g, '').trim();
  const m = /((?:\d+\/\d+\s*)+)=\s*(\d+)/.exec(s);
  if (m) {
    const beat = m[1].trim().split(/\s+/).reduce((acc, f) => acc + parseFraction(f), 0);
    return Math.round(parseInt(m[2], 10) * beat * 4);
  }
  const n = /^(\d+)$/.exec(s);
  return n ? parseInt(n[1], 10) : null;
}

export interface AbcOptions {
  /** Which tune to read when the file contains several (0-based). */
  tune?: number;
}

export function listAbcTunes(src: string): { index: number; title: string }[] {
  const out: { index: number; title: string }[] = [];
  let cur: { index: number; title: string } | null = null;
  for (const line of src.split(/\r?\n/)) {
    if (/^X:/.test(line)) {
      cur = { index: out.length, title: '' };
      out.push(cur);
    } else if (cur && /^T:/.test(line) && !cur.title) cur.title = line.slice(2).trim();
  }
  return out;
}

export function parseAbc(src: string, opts: AbcOptions = {}): Score {
  // Isolate the chosen tune.
  const lines = src.split(/\r?\n/);
  const starts = lines.map((l, i) => (/^X:/.test(l) ? i : -1)).filter((i) => i >= 0);
  let tuneLines = lines;
  if (starts.length) {
    const idx = Math.min(opts.tune ?? 0, starts.length - 1);
    tuneLines = lines.slice(starts[idx], starts[idx + 1] ?? lines.length);
  }

  const warnings: string[] = [];
  let title: string | undefined;
  let composer: string | undefined;
  let meter: [number, number] | null = null;
  let unit: number | null = null;
  let tempo: number | null = null;
  let fifths = 0;
  let keyFound = false;
  const bodyLines: string[] = [];

  for (const raw of tuneLines) {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    const field = /^([A-Za-z]):(.*)$/.exec(line);
    if (field) {
      const [, k, v] = field;
      if (keyFound) {
        // Field lines inside the body: only those that change how notes are read matter.
        if ('KMLQ'.includes(k)) bodyLines.push(`[${k}:${v}]`);
        continue;
      }
      switch (k) {
        case 'T':
          if (!title) title = v.trim();
          break;
        case 'C':
          composer = v.trim();
          break;
        case 'M':
          meter = parseMeter(v);
          break;
        case 'L':
          unit = parseFraction(v);
          break;
        case 'Q':
          tempo = parseTempo(v);
          break;
        case 'K':
          fifths = abcKeyFifths(v);
          keyFound = true;
          break;
      }
      continue;
    }
    bodyLines.push(line);
  }

  if (!unit) {
    const m = meter ?? [4, 4];
    unit = m[0] / m[1] < 0.75 ? 1 / 16 : 1 / 8;
  }
  const initialKeyFifths = fifths;
  const body = bodyLines.join('\n');

  const notes: NoteEvent[] = [];
  const bars: number[] = [0];
  let t = 0;
  let keyAcc = keyAccidentals(fifths);
  let barAcc: Record<string, number> = {};
  let tieNext = false;
  let brokenNext = 1; // multiplier for the next note
  let tuplet: { left: number; factor: number } | null = null;
  let hasRepeats = false;
  let i = 0;

  const readLength = (): number => {
    const m = /^(\d*)(\/*)(\d*)/.exec(body.slice(i));
    if (!m || !m[0]) return 1;
    i += m[0].length;
    const num = m[1] ? parseInt(m[1], 10) : 1;
    if (!m[2]) return num;
    const den = m[3] ? parseInt(m[3], 10) : 2 ** m[2].length;
    return num / den;
  };

  const addEvent = (pitch: number | null, lenUnits: number) => {
    let beats = lenUnits * (unit as number) * 4 * brokenNext;
    brokenNext = 1;
    if (tuplet) {
      beats *= tuplet.factor;
      if (--tuplet.left <= 0) tuplet = null;
    }
    // Broken rhythm: look ahead for > or <
    const br = /^\s*(>{1,3}|<{1,3})/.exec(body.slice(i));
    if (br) {
      i += br[0].length;
      const n = br[1].length;
      const lengthen = 2 - 1 / 2 ** n;
      const shorten = 1 / 2 ** n;
      if (br[1][0] === '>') {
        beats *= lengthen;
        brokenNext = shorten;
      } else {
        beats *= shorten;
        brokenNext = lengthen;
      }
    }
    if (pitch !== null && tieNext) {
      const prev = notes[notes.length - 1];
      if (prev && prev.pitch === pitch && Math.abs(prev.start + prev.duration - t) < 1e-6) {
        prev.duration += beats;
        t += beats;
        tieNext = false;
        return;
      }
    }
    tieNext = false;
    if (pitch !== null) notes.push({ pitch, start: t, duration: beats });
    t += beats;
  };

  const readPitch = (): number | null => {
    const m = /^(\^\^|__|\^|_|=)?([A-Ga-g])([',]*)/.exec(body.slice(i));
    if (!m) return null;
    i += m[0].length;
    const letter = m[2].toUpperCase();
    let octave = m[2] === letter ? 4 : 5;
    for (const c of m[3]) octave += c === "'" ? 1 : -1;
    const key = `${letter}${octave}`;
    let acc: number;
    if (m[1]) {
      acc = { '^^': 2, '^': 1, '=': 0, _: -1, __: -2 }[m[1]] as number;
      barAcc[key] = acc;
    } else acc = barAcc[key] ?? keyAcc[letter] ?? 0;
    return (octave + 1) * 12 + letterPc(letter) + acc;
  };

  const barline = () => {
    barAcc = {};
    if (Math.abs(bars[bars.length - 1] - t) > 1e-6) bars.push(t);
  };

  while (i < body.length) {
    const c = body[i];
    const rest = body.slice(i);
    if (/\s/.test(c) || c === '\\' || c === '`') {
      i++;
    } else if (c === '"') {
      const e = body.indexOf('"', i + 1);
      i = e < 0 ? body.length : e + 1;
    } else if (c === '!' || c === '+') {
      const e = body.indexOf(c, i + 1);
      i = e < 0 || body.slice(i, e).includes('\n') ? i + 1 : e + 1;
    } else if (c === '{') {
      const e = body.indexOf('}', i);
      i = e < 0 ? body.length : e + 1; // grace notes ignored
    } else if (/^\[[A-Za-z]:/.test(rest)) {
      const e = body.indexOf(']', i);
      const inner = body.slice(i + 1, e < 0 ? body.length : e);
      i = e < 0 ? body.length : e + 1;
      const k = inner[0];
      const v = inner.slice(2);
      if (k === 'K') {
        fifths = abcKeyFifths(v);
        keyAcc = keyAccidentals(fifths);
      } else if (k === 'M') meter = parseMeter(v) ?? meter;
      else if (k === 'L') unit = parseFraction(v) || unit;
      else if (k === 'Q') tempo = tempo ?? parseTempo(v);
    } else if (/^(\||:\||::|\[\||\[\d|:+\|)/.test(rest)) {
      const m = /^\[?[|:]+\]?\d*(?:[,-]\d+)*|^\[\d+(?:[,-]\d+)*/.exec(rest)!;
      if (/:|\d/.test(m[0])) hasRepeats = true;
      i += m[0].length;
      barline();
    } else if (c === ':' ) {
      hasRepeats = true;
      i++;
    } else if (c === '(') {
      const m = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(rest);
      if (m) {
        const p = parseInt(m[1], 10);
        const compound = meter ? meter[0] % 3 === 0 && meter[0] > 3 : false;
        const qDefault: Record<number, number> = { 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 };
        const q = m[2] ? parseInt(m[2], 10) : qDefault[p] ?? (compound ? 3 : 2);
        const r = m[3] ? parseInt(m[3], 10) : p;
        tuplet = { left: r, factor: q / p };
        i += m[0].length;
      } else i++; // slur
    } else if (c === ')' || c === '.' || c === '~' || /[HLMOPSTuv]/.test(c)) {
      i++;
    } else if (c === '-') {
      tieNext = true;
      i++;
    } else if (c === '[') {
      // Chord: keep the top note, length from first note (or after the bracket).
      i++;
      let top: number | null = null;
      let firstLen: number | null = null;
      while (i < body.length && body[i] !== ']') {
        const p = readPitch();
        if (p === null) {
          i++;
          continue;
        }
        const len = readLength();
        if (firstLen === null) firstLen = len;
        if (top === null || p > top) top = p;
      }
      i++;
      const after = readLength();
      if (top !== null) addEvent(top, (firstLen ?? 1) * after);
      if (body[i] === '-') {
        tieNext = true;
        i++;
      }
    } else if (c === 'z' || c === 'x') {
      i++;
      addEvent(null, readLength());
    } else if (c === 'Z' || c === 'X') {
      i++;
      const m = /^\d+/.exec(body.slice(i));
      const count = m ? parseInt(m[0], 10) : 1;
      if (m) i += m[0].length;
      const ts = meter ?? [4, 4];
      addEvent(null, (count * ts[0]) / ts[1] / (unit as number));
    } else if (/[\^_=A-Ga-g]/.test(c)) {
      const p = readPitch();
      if (p === null) {
        i++;
        continue;
      }
      const len = readLength();
      const tieAfter = body[i] === '-';
      if (tieAfter) i++;
      addEvent(p, len);
      if (tieAfter) tieNext = true;
    } else {
      i++; // unknown symbol
    }
  }

  if (hasRepeats) warnings.push('Repeat signs are not expanded; the music is read straight through.');
  if (Math.abs(bars[bars.length - 1] - t) < 1e-6 && bars.length > 1) bars.pop();

  return {
    title,
    composer,
    tempo: tempo ?? 120,
    timeSignature: meter ?? [4, 4],
    keyFifths: initialKeyFifths,
    notes: toMonophonic(notes, warnings),
    bars,
    warnings,
  };
}
