// Standard staff notation (treble clef) for an arrangement, as a plain SVG string.
// Everything is drawn with paths and lines, with no music font, so it looks the same in the app, in
// exported files and in a WebView. Each note is a <g class="cell" data-index> like the tab sheet, so
// playback highlighting and click-to-play work on both views.

import { Arrangement, TabEvent, TabStatus } from '../arrange.ts';
import { escapeXml, LIGHT_TEXT } from './diagram.ts';
import { sheetChrome, sheetHeader, SheetResult } from './sheet.ts';

export type Clef = 'treble' | 'treble8va' | 'treble8vb';

export interface StaffOptions {
  width?: number;
  /** Multiplies the staff size (default 1: 8 px between staff lines). */
  scale?: number;
  showHeader?: boolean;
  showLyrics?: boolean;
  /** 'auto' (default) uses an octave clef when the melody sits very high or low. */
  clef?: Clef | 'auto';
  textColor?: string;
  mutedColor?: string;
  warnColor?: string;
  errorColor?: string;
  background?: string | null;
  adaptive?: boolean;
  fontFamily?: string;
}

// ---------------------------------------------------------------------------
// Pitch spelling

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter index, C = 0)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Alteration (+1 sharp, −1 flat) the key signature applies to a letter. */
export function keyAlter(fifths: number, letter: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

/** Major key (−6 … 6 fifths) whose scale covers most of the melody, preferring fewer accidentals. */
export function inferKeyFifths(events: { pitch: number | null; duration: number }[]): number {
  const w = new Array(12).fill(0);
  for (const e of events) if (e.pitch !== null) w[mod(e.pitch, 12)] += e.duration;
  let best = 0;
  let bestScore = -Infinity;
  for (let k = -6; k <= 6; k++) {
    const tonic = mod(k * 7, 12);
    const score = MAJOR.reduce((s, d) => s + w[mod(tonic + d, 12)], 0) - Math.abs(k) * 1e-3;
    if (score > bestScore + 1e-9) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

export interface Spelling {
  letter: number; // 0 = C … 6 = B
  acc: number; // −2 … 2
  octave: number;
  /** Diatonic step number: octave * 7 + letter (E4 = 30, the bottom line of the treble staff). */
  step: number;
}

/** Spell a MIDI pitch in a key: scale notes as in the key, other notes with sharps in sharp keys, flats in flat keys. */
export function spellPitch(midi: number, fifths: number): Spelling {
  const pc = mod(midi, 12);
  let best: Spelling | null = null;
  let bestCost = Infinity;
  for (let letter = 0; letter < 7; letter++) {
    for (let acc = -2; acc <= 2; acc++) {
      if (mod(LETTER_PC[letter] + acc, 12) !== pc) continue;
      let cost = Math.abs(acc) * 2;
      if (acc === keyAlter(fifths, letter)) cost -= 10;
      if (fifths > 0 && acc < 0) cost += 1;
      if (fifths < 0 && acc > 0) cost += 1;
      if (fifths === 0 && acc < 0 && pc !== 10 && pc !== 3) cost += 1; // C major: C# F# G#, but Bb Eb
      if (fifths === 0 && acc > 0 && (pc === 10 || pc === 3)) cost += 1;
      if (cost < bestCost) {
        bestCost = cost;
        const octave = Math.round((midi - LETTER_PC[letter] - acc) / 12) - 1;
        best = { letter, acc, octave, step: octave * 7 + letter };
      }
    }
  }
  return best!;
}

// ---------------------------------------------------------------------------
// Rhythm: split notes at bar lines and into notatable values

type Base = 'w' | 'h' | 'q' | '8' | '16' | '32';
interface Piece {
  dur: number;
  base: Base;
  dots: number;
  triplet: boolean;
}

const PLAIN: Piece[] = [
  { dur: 4, base: 'w', dots: 0, triplet: false },
  { dur: 3, base: 'h', dots: 1, triplet: false },
  { dur: 2, base: 'h', dots: 0, triplet: false },
  { dur: 1.5, base: 'q', dots: 1, triplet: false },
  { dur: 1, base: 'q', dots: 0, triplet: false },
  { dur: 0.75, base: '8', dots: 1, triplet: false },
  { dur: 0.5, base: '8', dots: 0, triplet: false },
  { dur: 0.375, base: '16', dots: 1, triplet: false },
  { dur: 0.25, base: '16', dots: 0, triplet: false },
  { dur: 0.125, base: '32', dots: 0, triplet: false },
];
const TRIPLET: Piece[] = [
  { dur: 2 / 3, base: 'q', dots: 0, triplet: true },
  { dur: 1 / 3, base: '8', dots: 0, triplet: true },
  { dur: 1 / 6, base: '16', dots: 0, triplet: true },
];
const EPS = 1e-6;
const isMultiple = (x: number, q: number) => Math.abs(x / q - Math.round(x / q)) < 1e-4;

function greedy(d: number, values: Piece[]): Piece[] {
  const out: Piece[] = [];
  let r = d;
  while (r > 0.06) {
    const v = values.find((p) => p.dur <= r + 1e-4);
    if (!v) break;
    out.push(v);
    r -= v.dur;
  }
  return out;
}

/** Notatable pieces for a duration in beats (quarter = 1); tied together when there is more than one. */
export function splitDuration(d: number): Piece[] {
  if (isMultiple(d, 0.125)) return greedy(d, PLAIN);
  const whole = Math.floor(d + EPS);
  const frac = d - whole;
  if (isMultiple(frac, 1 / 6)) return [...greedy(whole, PLAIN), ...greedy(frac, TRIPLET)];
  return greedy(Math.round(d * 8) / 8, PLAIN);
}

// ---------------------------------------------------------------------------
// Layout model

interface Item extends Piece {
  ev: TabEvent;
  start: number;
  measure: number;
  rest: boolean;
  tieNext: boolean;
  tiedFromPrev: boolean;
  spell: Spelling | null;
  /** Accidental to print (−2 … 2) or null. */
  showAcc: number | null;
  // Filled during layout:
  x: number;
  w: number;
  headX: number;
  line: number;
  stemUp: boolean;
  beamed: boolean;
}

interface Measure {
  index: number;
  start: number;
  items: Item[];
  width: number;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

// G clef, in staff spaces: x right, y down, top staff line at y = 0, G line at y = 3.
const G_CLEF =
  'M1.62,3.38 C1.05,3.47 0.86,2.75 1.4,2.55 C2.18,2.28 2.52,3.33 1.86,3.86 C1.15,4.42 0.12,3.92 0.2,2.92 C0.27,1.93 1.58,1.46 1.95,0.55 C2.27,-0.24 2.08,-1.34 1.67,-1.52 C1.18,-1.72 0.92,-0.72 1.08,0.25 L1.7,4.95 C1.8,5.62 0.98,5.86 0.78,5.32';

export function renderStaffSvg(arr: Arrangement, opts: StaffOptions = {}): SheetResult {
  const sp = 8 * Math.min(4, Math.max(0.4, opts.scale ?? 1));
  let W = Math.max(240, opts.width ?? 860);
  const pad = 20;
  const text = opts.textColor ?? LIGHT_TEXT.text;
  const muted = opts.mutedColor ?? LIGHT_TEXT.muted;
  const warn = opts.warnColor ?? LIGHT_TEXT.warn;
  const err = opts.errorColor ?? LIGHT_TEXT.err;
  const font = opts.fontFamily ?? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const showLyrics = (opts.showLyrics ?? true) && arr.events.some((e) => e.lyric);
  const [num, den] = arr.timeSignature;
  const fifths = arr.keyFifths ?? inferKeyFifths(arr.events);

  // Clef: treble, or an octave clef when most notes would need many ledger lines.
  const pitches = arr.events.filter((e) => e.pitch !== null).map((e) => e.pitch as number).sort((a, b) => a - b);
  const median = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 72;
  const clef: Clef = opts.clef && opts.clef !== 'auto' ? opts.clef : median >= 86 ? 'treble8va' : median < 57 ? 'treble8vb' : 'treble';
  const octShift = clef === 'treble8va' ? -7 : clef === 'treble8vb' ? 7 : 0;

  // ---- Build items, measure by measure.
  const bars = arr.bars.length ? arr.bars : [0];
  const measures: Measure[] = bars.map((start, index) => ({ index, start, items: [], width: 0 }));
  const measureAt = (t: number) => {
    let m = 0;
    for (let i = 0; i < bars.length; i++) if (bars[i] <= t + EPS) m = i;
    return m;
  };
  for (const ev of arr.events) {
    const end = ev.start + ev.duration;
    let t = ev.start;
    const isRest = ev.status === 'rest' || ev.pitch === null;
    const spell = isRest ? null : spellPitch(ev.pitch as number, fifths);
    if (spell) spell.step += octShift;
    const pieces: { start: number; piece: Piece; measure: number }[] = [];
    while (t < end - EPS) {
      const m = measureAt(t);
      const barEnd = m + 1 < bars.length ? bars[m + 1] : Infinity;
      const segEnd = Math.min(end, barEnd);
      let s = t;
      for (const piece of splitDuration(segEnd - t)) {
        pieces.push({ start: s, piece, measure: m });
        s += piece.dur;
      }
      t = segEnd;
    }
    pieces.forEach((p, i) => {
      measures[p.measure].items.push({
        ...p.piece,
        ev,
        start: p.start,
        measure: p.measure,
        rest: isRest,
        tieNext: !isRest && i < pieces.length - 1,
        tiedFromPrev: !isRest && i > 0,
        spell,
        showAcc: null,
        x: 0,
        w: 0,
        headX: 0,
        line: 0,
        stemUp: true,
        beamed: false,
      });
    });
  }

  // ---- Accidentals, reset at every bar.
  for (const m of measures) {
    const current = new Map<number, number>();
    for (const it of m.items) {
      if (!it.spell) continue;
      const k = it.spell.step;
      const now = current.has(k) ? (current.get(k) as number) : keyAlter(fifths, it.spell.letter);
      if (it.spell.acc !== now && !it.tiedFromPrev) it.showAcc = it.spell.acc;
      current.set(k, it.spell.acc);
    }
  }

  // ---- Horizontal sizes.
  const accW = 1.3 * sp;
  for (const m of measures) {
    let x = sp * 1.1;
    for (const it of m.items) {
      it.w = sp * (1.9 + 2.1 * Math.sqrt(it.dur)) + (it.showAcc !== null ? accW : 0) + it.dots * 0.5 * sp;
      it.x = x;
      x += it.w;
    }
    m.width = x + sp * 0.5;
  }

  const ksW = Math.abs(fifths) * 0.95 * sp;
  const clefW = 3.2 * sp;
  const timeW = 2.6 * sp;
  const lineHead = (first: boolean) => clefW + ksW + (ksW ? 0.6 * sp : 0) + (first ? timeW : 0.4 * sp);
  const minW = Math.ceil(lineHead(true) + Math.max(sp * 8, ...measures.map((m) => m.width)) * 0.6 + 2 * pad);
  W = Math.max(W, minW);
  const avail = W - 2 * pad;

  // ---- Lines: fill with whole measures, then justify.
  const lines: Measure[][] = [];
  let cur: Measure[] = [];
  let used = lineHead(true);
  for (const m of measures.filter((mm) => mm.items.length)) {
    if (cur.length && used + m.width > avail) {
      lines.push(cur);
      cur = [];
      used = lineHead(false);
    }
    cur.push(m);
    used += m.width;
  }
  if (cur.length) lines.push(cur);

  const parts: string[] = [];
  let y = pad;
  if (opts.showHeader ?? true) {
    const h = sheetHeader(arr, W, y, { text, muted });
    parts.push(h.markup);
    y = h.y;
  }

  const roleOf = (s: TabStatus) => (s === 'out-of-range' ? 'err' : s === 'folded' ? 'warn' : 'text');
  const colorOf = (role: string) => (role === 'err' ? err : role === 'warn' ? warn : text);
  const ink = (role = 'text') => `class="oc-f-${role}" fill="${colorOf(role)}"`;
  const line = (role = 'text') => `class="oc-s-${role}" stroke="${colorOf(role)}"`;

  lines.forEach((lineMeasures, li) => {
    const first = li === 0;
    const head = lineHead(first);
    const natural = lineMeasures.reduce((s, m) => s + m.width, 0);
    const room = avail - head;
    const last = li === lines.length - 1;
    const stretch = !last || natural / room > 0.75 ? room / natural : Math.min(1, room / natural);

    // Positions.
    let x = pad + head;
    const items: Item[] = [];
    const barXs: number[] = [];
    for (const m of lineMeasures) {
      for (const it of m.items) {
        it.x = x + it.x * stretch;
        it.w *= stretch;
        it.headX = it.x + (it.showAcc !== null ? accW : 0) + 0.8 * sp;
        it.line = li;
        items.push(it);
      }
      x += m.width * stretch;
      barXs.push(x);
    }
    const right = x;

    // Vertical extent of this line.
    const steps = items.filter((i) => i.spell).map((i) => (i.spell as Spelling).step);
    const hi = steps.length ? Math.max(...steps) : 34;
    const lo = steps.length ? Math.min(...steps) : 34;
    const hasTriplet = items.some((i) => i.triplet);
    const above = Math.max(3.2, (hi - 38) / 2 + 2) * sp + (hasTriplet ? 1.2 * sp : 0);
    const belowNotes = Math.max(3.2, (30 - lo) / 2 + 2) * sp;
    const below = belowNotes + (showLyrics ? 2 * sp : 0);
    const top = y + above; // top staff line
    const bottom = top + 4 * sp;
    const yOf = (step: number) => bottom - ((step - 30) * sp) / 2;

    // Staff, clef, key and time signature.
    for (let i = 0; i < 5; i++) parts.push(`<line x1="${f1(pad)}" y1="${f1(top + i * sp)}" x2="${f1(right)}" y2="${f1(top + i * sp)}" ${line()} stroke-width="${f1(sp * 0.1)}"/>`);
    parts.push(`<g transform="translate(${f1(pad + 0.5 * sp)},${f1(top)}) scale(${sp})"><path d="${G_CLEF}" fill="none" ${line()} stroke-width="0.17" stroke-linecap="round" stroke-linejoin="round"/><circle cx="0.98" cy="5.2" r="0.3" ${ink()}/></g>`);
    if (clef !== 'treble') {
      const cy = clef === 'treble8va' ? top - 2 * sp : bottom + 2.7 * sp;
      parts.push(`<text x="${f1(pad + 1.5 * sp)}" y="${f1(cy)}" text-anchor="middle" font-size="${f1(sp * 1.15)}" font-style="italic" ${ink()}>8</text>`);
    }
    let kx = pad + clefW;
    const sharpSteps = [38, 35, 39, 36, 33, 37, 34];
    const flatSteps = [34, 37, 33, 36, 32, 35, 31];
    for (let i = 0; i < Math.abs(fifths); i++) {
      const st = fifths > 0 ? sharpSteps[i] : flatSteps[i];
      parts.push(accidentalMarkup(fifths > 0 ? 1 : -1, kx + 0.45 * sp, yOf(st), sp, line(), ink()));
      kx += 0.95 * sp;
    }
    if (first) {
      const tx = pad + clefW + ksW + (ksW ? 0.6 * sp : 0) + 0.9 * sp;
      const fs = sp * 2.1;
      const tsFont = `font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${f1(fs)}" text-anchor="middle"`;
      parts.push(`<text x="${f1(tx)}" y="${f1(top + 1.85 * sp)}" ${tsFont} ${ink()}>${num}</text>`);
      parts.push(`<text x="${f1(tx)}" y="${f1(top + 3.85 * sp)}" ${tsFont} ${ink()}>${den}</text>`);
    }
    // Measure number at the start of the line.
    parts.push(`<text x="${f1(pad)}" y="${f1(top - 1.3 * sp)}" font-size="${f1(Math.max(8, sp * 1.05))}" ${ink('muted')} opacity="0.85">${lineMeasures[0].index + 1}</text>`);

    // Bar lines (thin; thick final bar at the very end).
    barXs.forEach((bx, i) => {
      const isEnd = last && i === barXs.length - 1;
      if (isEnd) {
        parts.push(`<line x1="${f1(bx - 0.75 * sp)}" y1="${f1(top)}" x2="${f1(bx - 0.75 * sp)}" y2="${f1(bottom)}" ${line()} stroke-width="${f1(sp * 0.13)}"/>`);
        parts.push(`<line x1="${f1(bx - 0.22 * sp)}" y1="${f1(top)}" x2="${f1(bx - 0.22 * sp)}" y2="${f1(bottom)}" ${line()} stroke-width="${f1(sp * 0.45)}"/>`);
      } else parts.push(`<line x1="${f1(bx)}" y1="${f1(top)}" x2="${f1(bx)}" y2="${f1(bottom)}" ${line()} stroke-width="${f1(sp * 0.13)}"/>`);
    });

    // Stem directions and beams, per measure.
    for (const m of lineMeasures) {
      const unit = den === 8 && num % 3 === 0 ? 1.5 : den === 8 ? 0.5 * Math.max(1, num % 2 === 0 ? 2 : 1) : 4 / den;
      const groups: Item[][] = [];
      let g: Item[] = [];
      let gKey = -1;
      for (const it of m.items) {
        const beamable = !it.rest && (it.base === '8' || it.base === '16' || it.base === '32');
        const key = Math.floor((it.start - m.start + 1e-4) / unit);
        if (beamable && g.length && key === gKey) g.push(it);
        else {
          if (g.length) groups.push(g);
          g = beamable ? [it] : [];
          gKey = key;
        }
      }
      if (g.length) groups.push(g);
      for (const it of m.items) if (it.spell) it.stemUp = it.spell.step < 34;
      for (const grp of groups) {
        if (grp.length < 2) continue;
        const avg = grp.reduce((s, i) => s + (i.spell as Spelling).step, 0) / grp.length;
        for (const i of grp) {
          i.stemUp = avg < 34;
          i.beamed = true;
        }
        parts.push(beamMarkup(grp, yOf, sp, line, ink));
      }
    }

    // Notes and rests.
    items.forEach((it, idx) => {
      const role = it.rest ? 'text' : roleOf(it.ev.status);
      const g: string[] = [];
      const tip = it.rest ? `Rest` : `${it.ev.concertName ?? ''}${it.ev.status === 'folded' ? ' (moved by an octave)' : ''}${it.ev.status === 'out-of-range' ? ' (out of range)' : ''}`;
      g.push(`<g class="cell cell-${it.ev.status}" data-index="${it.ev.index}" data-start="${it.ev.start}"><title>${escapeXml(tip)}</title>`);
      g.push(`<rect class="cell-bg${it.ev.status === 'out-of-range' ? ' oc-f-err' : ''}" x="${f1(it.x)}" y="${f1(top - 2.6 * sp)}" width="${f1(Math.max(it.w - 1, 4))}" height="${f1(8.2 * sp)}" rx="4" fill="${it.ev.status === 'out-of-range' ? err : 'transparent'}" fill-opacity="${it.ev.status === 'out-of-range' ? 0.08 : 0}"/>`);
      if (it.rest) g.push(restMarkup(it, top, sp, line(), ink()));
      else g.push(noteMarkup(it, yOf, top, bottom, sp, line(role), ink(role)));
      // Tie to the next piece of the same note.
      if (it.tieNext && it.spell) {
        const nxt = items[idx + 1];
        const yy = yOf(it.spell.step) + (it.stemUp ? 0.75 : -0.75) * sp;
        const x1 = it.headX + 0.7 * sp;
        const x2 = nxt && nxt.ev === it.ev ? nxt.headX - 0.7 * sp : right - 0.3 * sp;
        const bend = (it.stemUp ? 1 : -1) * Math.min(1.1 * sp, 0.25 * (x2 - x1));
        g.push(`<path d="M${f1(x1)},${f1(yy)} Q${f1((x1 + x2) / 2)},${f1(yy + bend)} ${f1(x2)},${f1(yy)}" fill="none" ${line(role)} stroke-width="${f1(sp * 0.16)}" stroke-linecap="round"/>`);
      }
      if (showLyrics && it.ev.lyric && !it.tiedFromPrev) {
        g.push(`<text x="${f1(it.headX)}" y="${f1(bottom + belowNotes + 0.9 * sp)}" text-anchor="middle" font-size="${f1(Math.max(9, sp * 1.25))}" font-style="italic" ${ink('muted')}>${escapeXml(it.ev.lyric)}</text>`);
      }
      g.push('</g>');
      parts.push(g.join(''));
    });

    // Triplet numbers.
    let run: Item[] = [];
    const flush = () => {
      if (!run.length) return;
      const x1 = run[0].headX;
      const x2 = run[run.length - 1].headX;
      const tops = run.map((i) => (i.spell ? yOf(i.spell.step) - (i.stemUp ? 3.5 * sp : 0.8 * sp) : top));
      const ty = Math.min(top - 0.6 * sp, ...tops) - 0.5 * sp;
      parts.push(`<text x="${f1((x1 + x2) / 2)}" y="${f1(ty)}" text-anchor="middle" font-size="${f1(sp * 1.3)}" font-style="italic" font-weight="600" ${ink()}>3</text>`);
      run = [];
    };
    let acc = 0;
    for (const it of items) {
      if (!it.triplet) {
        flush();
        acc = 0;
        continue;
      }
      run.push(it);
      acc += it.dur;
      if (isMultiple(acc, it.base === 'q' ? 2 : 1)) {
        flush();
        acc = 0;
      }
    }
    flush();

    y = bottom + below + sp * 0.8;
  });

  const height = Math.ceil(y + pad / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="${escapeXml(font)}">${sheetChrome(opts)}${parts.join('')}</svg>`;
  return { svg, width: W, height };
}

// ---------------------------------------------------------------------------
// Glyphs

function accidentalMarkup(acc: number, x: number, y: number, sp: number, stroke: string, fill: string): string {
  const L = (x1: number, y1: number, x2: number, y2: number, w: number) =>
    `<line x1="${f1(x + x1 * sp)}" y1="${f1(y + y1 * sp)}" x2="${f1(x + x2 * sp)}" y2="${f1(y + y2 * sp)}" ${stroke} stroke-width="${f1(w * sp)}"/>`;
  if (acc === 1)
    return L(-0.22, -1.2, -0.22, 1.35, 0.1) + L(0.22, -1.35, 0.22, 1.2, 0.1) + L(-0.5, -0.3, 0.5, -0.55, 0.26) + L(-0.5, 0.55, 0.5, 0.3, 0.26);
  if (acc === -1)
    return L(-0.3, -1.75, -0.3, 0.5, 0.11) + `<path d="M${f1(x - 0.3 * sp)},${f1(y + 0.5 * sp)} C${f1(x + 0.75 * sp)},${f1(y - 0.15 * sp)} ${f1(x + 0.55 * sp)},${f1(y - 0.95 * sp)} ${f1(x - 0.3 * sp)},${f1(y - 0.2 * sp)}" fill="none" ${stroke} stroke-width="${f1(0.19 * sp)}"/>`;
  if (acc === 0) return L(-0.27, -1.3, -0.27, 0.55, 0.1) + L(0.27, -0.55, 0.27, 1.3, 0.1) + L(-0.27, -0.25, 0.27, -0.45, 0.24) + L(-0.27, 0.45, 0.27, 0.25, 0.24);
  if (acc === 2) return L(-0.38, -0.38, 0.38, 0.38, 0.17) + L(-0.38, 0.38, 0.38, -0.38, 0.17) + `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.12 * sp)}" ${fill}/>`;
  if (acc === -2) return accidentalMarkup(-1, x - 0.35 * sp, y, sp, stroke, fill) + accidentalMarkup(-1, x + 0.35 * sp, y, sp, stroke, fill);
  return '';
}

function noteMarkup(it: Item, yOf: (s: number) => number, top: number, bottom: number, sp: number, stroke: string, fill: string): string {
  const s = it.spell as Spelling;
  const hy = yOf(s.step);
  const hx = it.headX;
  const out: string[] = [];
  // Ledger lines.
  for (let l = 28; l >= s.step; l -= 2) out.push(`<line x1="${f1(hx - 1.05 * sp)}" y1="${f1(yOf(l))}" x2="${f1(hx + 1.05 * sp)}" y2="${f1(yOf(l))}" ${stroke} stroke-width="${f1(sp * 0.12)}"/>`);
  for (let l = 40; l <= s.step; l += 2) out.push(`<line x1="${f1(hx - 1.05 * sp)}" y1="${f1(yOf(l))}" x2="${f1(hx + 1.05 * sp)}" y2="${f1(yOf(l))}" ${stroke} stroke-width="${f1(sp * 0.12)}"/>`);
  if (it.showAcc !== null) out.push(accidentalMarkup(it.showAcc, hx - 1.75 * sp, hy, sp, stroke, fill));
  // Head.
  if (it.base === 'w') out.push(`<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="${f1(0.72 * sp)}" ry="${f1(0.44 * sp)}" fill="none" ${stroke} stroke-width="${f1(0.22 * sp)}"/>`);
  else if (it.base === 'h')
    out.push(`<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="${f1(0.56 * sp)}" ry="${f1(0.36 * sp)}" transform="rotate(-25 ${f1(hx)} ${f1(hy)})" fill="none" ${stroke} stroke-width="${f1(0.18 * sp)}"/>`);
  else out.push(`<ellipse cx="${f1(hx)}" cy="${f1(hy)}" rx="${f1(0.64 * sp)}" ry="${f1(0.44 * sp)}" transform="rotate(-25 ${f1(hx)} ${f1(hy)})" ${fill}/>`);
  // Dots (in the space above when the head is on a line).
  const onLine = (s.step - 30) % 2 === 0;
  for (let d = 0; d < it.dots; d++) out.push(`<circle cx="${f1(hx + (1.15 + d * 0.5) * sp)}" cy="${f1(hy - (onLine ? 0.5 * sp : 0))}" r="${f1(0.17 * sp)}" ${fill}/>`);
  // Stem and flags (beams are drawn per group).
  if (it.base !== 'w') {
    const sx = it.stemUp ? hx + 0.6 * sp : hx - 0.6 * sp;
    if (!it.beamed) {
      const tip = it.stemUp ? Math.min(hy - 3.5 * sp, it.base === '16' || it.base === '32' ? hy - 4 * sp : Infinity) : Math.max(hy + 3.5 * sp, it.base === '16' || it.base === '32' ? hy + 4 * sp : -Infinity);
      // Stems reach at least the middle line for notes far outside the staff.
      const mid = (top + bottom) / 2;
      const tipY = it.stemUp ? Math.min(tip, mid) : Math.max(tip, mid);
      out.push(`<line x1="${f1(sx)}" y1="${f1(hy + (it.stemUp ? -0.15 : 0.15) * sp)}" x2="${f1(sx)}" y2="${f1(tipY)}" ${stroke} stroke-width="${f1(sp * 0.12)}"/>`);
      const flags = it.base === '8' ? 1 : it.base === '16' ? 2 : it.base === '32' ? 3 : 0;
      for (let k = 0; k < flags; k++) {
        const fy = tipY + (it.stemUp ? 1 : -1) * k * 0.85 * sp;
        const d = it.stemUp ? 1 : -1;
        out.push(`<path d="M${f1(sx)},${f1(fy)} C${f1(sx + 0.15 * sp)},${f1(fy + d * 1.1 * sp)} ${f1(sx + 1.3 * sp)},${f1(fy + d * 1.35 * sp)} ${f1(sx + 0.85 * sp)},${f1(fy + d * 2.75 * sp)}" fill="none" ${stroke} stroke-width="${f1(sp * 0.22)}" stroke-linecap="round"/>`);
      }
    }
  }
  return out.join('');
}

function beamMarkup(grp: Item[], yOf: (s: number) => number, sp: number, line: (r?: string) => string, ink: (r?: string) => string): string {
  const up = grp[0].stemUp;
  const d = up ? -1 : 1;
  const sx = grp.map((i) => (up ? i.headX + 0.6 * sp : i.headX - 0.6 * sp));
  const hy = grp.map((i) => yOf((i.spell as Spelling).step));
  let y1 = hy[0] + d * 3.5 * sp;
  let y2 = hy[hy.length - 1] + d * 3.5 * sp;
  const maxSlope = 1 * sp;
  if (Math.abs(y2 - y1) > maxSlope) y2 = y1 + Math.sign(y2 - y1) * maxSlope;
  const at = (x: number) => y1 + ((y2 - y1) * (x - sx[0])) / (sx[sx.length - 1] - sx[0] || 1);
  // Make every stem at least 2.6 spaces long.
  let shift = 0;
  grp.forEach((_, i) => {
    const len = (at(sx[i]) - hy[i]) * d;
    if (len < 2.6 * sp) shift = Math.max(shift, 2.6 * sp - len);
  });
  y1 += d * shift;
  y2 += d * shift;
  const out: string[] = [];
  const th = 0.48 * sp;
  const beam = (xa: number, xb: number, level: number) => {
    const off = -d * level * 0.78 * sp; // inner beams sit towards the heads
    const ya = at(xa) + off;
    const yb = at(xb) + off;
    const t = -d * th; // thickness towards the heads
    out.push(`<path d="M${f1(xa)},${f1(ya)} L${f1(xb)},${f1(yb)} L${f1(xb)},${f1(yb + t)} L${f1(xa)},${f1(ya + t)} Z" ${ink(roleFor(grp))}/>`);
  };
  // Stems.
  grp.forEach((it, i) => {
    const role = it.ev.status === 'out-of-range' ? 'err' : it.ev.status === 'folded' ? 'warn' : 'text';
    out.push(`<line x1="${f1(sx[i])}" y1="${f1(hy[i] + d * 0.15 * sp)}" x2="${f1(sx[i])}" y2="${f1(at(sx[i]))}" ${line(role)} stroke-width="${f1(sp * 0.12)}"/>`);
  });
  beam(sx[0], sx[sx.length - 1], 0);
  const levels = (it: Item) => (it.base === '8' ? 1 : it.base === '16' ? 2 : 3);
  for (let level = 2; level <= 3; level++) {
    for (let i = 0; i < grp.length; i++) {
      if (levels(grp[i]) < level) continue;
      if (i + 1 < grp.length && levels(grp[i + 1]) >= level) {
        beam(sx[i], sx[i + 1], level - 1);
        continue;
      }
      if (i > 0 && levels(grp[i - 1]) >= level) continue; // already joined to the left
      // Lone short note in the group: a stub towards its neighbour.
      const dir = i > 0 ? -1 : 1;
      beam(sx[i], sx[i] + dir * 1.1 * sp, level - 1);
    }
  }
  return out.join('');
}

function roleFor(grp: Item[]): string {
  return grp.some((i) => i.ev.status === 'out-of-range') ? 'err' : 'text';
}

function restMarkup(it: Item, top: number, sp: number, stroke: string, fill: string): string {
  const x = it.headX;
  const out: string[] = [];
  const P = (d: string, w: number) => `<path d="${d}" fill="none" ${stroke} stroke-width="${f1(w * sp)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const X = (u: number) => f1(x + u * sp);
  const Y = (u: number) => f1(top + u * sp);
  switch (it.base) {
    case 'w':
      out.push(`<rect x="${X(-0.6)}" y="${Y(1)}" width="${f1(1.2 * sp)}" height="${f1(0.5 * sp)}" ${fill}/>`);
      break;
    case 'h':
      out.push(`<rect x="${X(-0.6)}" y="${Y(1.5)}" width="${f1(1.2 * sp)}" height="${f1(0.5 * sp)}" ${fill}/>`);
      break;
    case 'q':
      out.push(P(`M${X(-0.3)},${Y(0.55)} L${X(0.35)},${Y(1.35)} C${X(-0.15)},${Y(1.75)} ${X(-0.15)},${Y(2.1)} ${X(0.35)},${Y(2.6)} C${X(-0.35)},${Y(2.45)} ${X(-0.45)},${Y(3.05)} ${X(0.05)},${Y(3.4)}`, 0.28));
      break;
    default: {
      const n = it.base === '8' ? 1 : it.base === '16' ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const oy = 1.3 + k * 0.9;
        out.push(`<circle cx="${X(-0.25 - k * 0.2)}" cy="${Y(oy)}" r="${f1(0.24 * sp)}" ${fill}/>`);
        out.push(P(`M${X(-0.25 - k * 0.2)},${Y(oy + 0.1)} Q${X(0.15 - k * 0.2)},${Y(oy + 0.25)} ${X(0.45 - k * 0.2)},${Y(oy - 0.25)}`, 0.15));
      }
      out.push(P(`M${X(0.45)},${Y(1.05)} L${X(-0.25 - n * 0.2)},${Y(3.3 + (n - 1) * 0.6)}`, 0.13));
    }
  }
  for (let d = 0; d < it.dots; d++) out.push(`<circle cx="${X(0.95 + d * 0.5)}" cy="${Y(1.5)}" r="${f1(0.17 * sp)}" ${fill}/>`);
  return out.join('');
}
