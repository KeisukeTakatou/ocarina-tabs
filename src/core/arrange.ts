// Map a melody onto an ocarina: choose a transposition, look up fingerings, flag problems.

import {
  cleanHoles,
  COMMON_KEYS,
  fingeringDifficulty,
  fingeringsFor,
  InstrumentDef,
  listInstruments,
  OcarinaSpec,
  offsetRange,
  resolveTonic,
  Voice,
  VOICES,
} from './instruments.ts';
import { keyPrefersFlats, majorKeyFifths, midiToName, pitchClass } from './pitch.ts';
import { measureIndexAt, measureStarts, Score } from './score.ts';

export type TransposeMode = 'auto' | 'octave' | 'none' | number;

export interface ArrangeOptions {
  /**
   * auto   – any transposition (-24..+24) that best fits the range and avoids half holes
   * octave – only whole-octave shifts (keeps the original key)
   * none   – play exactly at concert pitch
   * number – fixed transposition in semitones
   */
  transpose?: TransposeMode;
  /** fold: move out-of-range notes by octaves into range; mark: leave them flagged. */
  outOfRange?: 'fold' | 'mark';
}

export type TabStatus = 'ok' | 'folded' | 'out-of-range' | 'rest';

export interface TabEvent {
  index: number;
  start: number;
  duration: number;
  measure: number;
  /** Original (concert) pitch from the source. */
  sourcePitch: number | null;
  /** Sounding pitch on the ocarina, after transposition/folding. */
  pitch: number | null;
  /** Semitones above the ocarina tonic. */
  offset: number | null;
  /** Primary fingering (X/O/H per hole) or null for rests / unplayable notes. */
  holes: string | null;
  alternatives: string[];
  status: TabStatus;
  /** Sounding (concert) note name, e.g. "G4". */
  concertName: string | null;
  /** Name as read on a C-fingered chart, e.g. "C5" for the tonic. Same as concert on a C ocarina. */
  fingeringName: string | null;
  lyric?: string;
}

export interface Arrangement {
  title?: string;
  composer?: string;
  tempo: number;
  timeSignature: [number, number];
  instrument: { id: string; name: string };
  tonic: number;
  tonicName: string;
  transpose: number;
  bars: number[];
  events: TabEvent[];
  stats: {
    notes: number;
    playable: number;
    folded: number;
    outOfRange: number;
    halfHoles: number;
    lowest: string | null;
    highest: string | null;
  };
  warnings: string[];
}

interface Candidate {
  t: number;
  out: number;
  difficulty: number;
  cost: number;
}

function evaluate(pitches: number[], spec: OcarinaSpec, t: number): Candidate {
  const [lo, hi] = offsetRange(spec.instrument);
  let out = 0;
  let difficulty = 0;
  for (const p of pitches) {
    const off = p + t - spec.tonic;
    if (off < lo || off > hi) {
      out++;
      continue;
    }
    const f = fingeringsFor(spec.instrument, off)[0];
    if (!f) out++;
    else difficulty += fingeringDifficulty(f.holes);
  }
  const keyChange = ((t % 12) + 12) % 12 !== 0 ? 1 : 0;
  // Out-of-range notes dominate; then prefer keeping the key, fewer half holes, smaller shifts.
  const cost = out * 1000 + difficulty + keyChange * 25 + Math.abs(t) * 0.5;
  return { t, out, difficulty, cost };
}

export function candidateTranspositions(mode: TransposeMode): number[] {
  if (typeof mode === 'number') return [mode];
  if (mode === 'none') return [0];
  const out: number[] = [];
  if (mode === 'octave') for (let t = -48; t <= 48; t += 12) out.push(t);
  else for (let t = -36; t <= 36; t++) out.push(t);
  return out;
}

/** Best transposition (in semitones) for the given pitches on the ocarina. */
export function chooseTransposition(pitches: number[], spec: OcarinaSpec, mode: TransposeMode = 'auto'): Candidate {
  let best: Candidate | null = null;
  for (const t of candidateTranspositions(mode)) {
    const c = evaluate(pitches, spec, t);
    if (!best || c.cost < best.cost - 1e-9) best = c;
  }
  return best as Candidate;
}

export function arrange(score: Score, spec: OcarinaSpec, options: ArrangeOptions = {}): Arrangement {
  const mode = options.transpose ?? 'auto';
  const outMode = options.outOfRange ?? 'fold';
  const inst = spec.instrument;
  const [lo, hi] = offsetRange(inst);
  const pitches = score.notes.filter((n) => n.pitch !== null).map((n) => n.pitch as number);
  const choice = pitches.length ? chooseTransposition(pitches, spec, mode) : { t: typeof mode === 'number' ? mode : 0 };
  const t = choice.t;
  const warnings = [...score.warnings];

  // Spelling: sharps/flats follow the (transposed) key of the piece.
  const songTonicPc = score.keyFifths !== undefined ? pitchClass(score.keyFifths * 7) : 0;
  const concertFlats = score.keyFifths !== undefined ? majorKeyFifths(pitchClass(songTonicPc + t)) < 0 : false;
  const fingeringFlats = score.keyFifths !== undefined ? majorKeyFifths(pitchClass(songTonicPc + t - spec.tonic)) < 0 : false;

  const bars = measureStarts(score);
  const events: TabEvent[] = [];
  let folded = 0;
  let outOfRange = 0;
  let halfHoles = 0;
  let lowest = Infinity;
  let highest = -Infinity;

  score.notes.forEach((n, index) => {
    const base: TabEvent = {
      index,
      start: n.start,
      duration: n.duration,
      measure: measureIndexAt(bars, n.start),
      sourcePitch: n.pitch,
      pitch: null,
      offset: null,
      holes: null,
      alternatives: [],
      status: 'rest',
      concertName: null,
      fingeringName: null,
      lyric: n.lyric,
    };
    if (n.pitch === null) {
      events.push(base);
      return;
    }
    let p = n.pitch + t;
    let status: TabStatus = 'ok';
    let off = p - spec.tonic;
    if (off < lo || off > hi) {
      if (outMode === 'fold') {
        while (off < lo) off += 12;
        while (off > hi) off -= 12;
        if (off >= lo && off <= hi) {
          p = spec.tonic + off;
          status = 'folded';
        } else status = 'out-of-range';
      } else status = 'out-of-range';
    }
    const fs = status === 'out-of-range' ? [] : fingeringsFor(inst, off);
    if (status !== 'out-of-range' && !fs.length) status = 'out-of-range';
    if (status === 'folded') folded++;
    if (status === 'out-of-range') outOfRange++;
    const holes = fs[0] ? cleanHoles(fs[0].holes) : null;
    if (holes?.includes('H')) halfHoles++;
    if (status !== 'out-of-range') {
      lowest = Math.min(lowest, p);
      highest = Math.max(highest, p);
    }
    events.push({
      ...base,
      pitch: p,
      offset: off,
      holes,
      alternatives: fs.slice(1).map((f) => cleanHoles(f.holes)),
      status,
      concertName: midiToName(p, concertFlats),
      fingeringName: midiToName(72 + off, fingeringFlats),
    });
  });

  if (folded) warnings.push(`${folded} note(s) were outside the range and moved by an octave (marked).`);
  if (outOfRange) warnings.push(`${outOfRange} note(s) cannot be played on this ocarina (marked).`);

  const notes = pitches.length;
  const tonicFlats = keyPrefersFlats(spec.tonic);
  return {
    title: score.title,
    composer: score.composer,
    tempo: score.tempo,
    timeSignature: score.timeSignature,
    instrument: { id: inst.id, name: inst.name },
    tonic: spec.tonic,
    tonicName: midiToName(spec.tonic, tonicFlats),
    transpose: t,
    bars,
    events,
    stats: {
      notes,
      playable: notes - outOfRange,
      folded,
      outOfRange,
      halfHoles,
      lowest: lowest === Infinity ? null : midiToName(lowest, concertFlats),
      highest: highest === -Infinity ? null : midiToName(highest, concertFlats),
    },
    warnings,
  };
}

export interface Suggestion {
  instrument: string;
  instrumentName: string;
  key: string;
  voice: Voice;
  tonic: string;
  transpose: number;
  outOfRange: number;
  halfHoles: number;
  /** Lower is better. */
  cost: number;
}

/**
 * Rank ocarinas (instrument × key × voice) for a score.
 * With transpose "none" this answers "which ocarina plays this at the written pitch?".
 */
export function suggestOcarinas(
  score: Score,
  opts: { transpose?: TransposeMode; instruments?: InstrumentDef[]; limit?: number } = {},
): Suggestion[] {
  const pitches = score.notes.filter((n) => n.pitch !== null).map((n) => n.pitch as number);
  if (!pitches.length) return [];
  const mode = opts.transpose ?? 'octave';
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const inst of opts.instruments ?? listInstruments()) {
    for (const key of COMMON_KEYS) {
      for (const voice of VOICES) {
        const tonic = resolveTonic(key, voice);
        const c = chooseTransposition(pitches, { instrument: inst, tonic }, mode);
        const id = `${inst.id}|${tonic}|${c.t}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          instrument: inst.id,
          instrumentName: inst.name,
          key,
          voice,
          tonic: midiToName(tonic, keyPrefersFlats(tonic)),
          transpose: c.t,
          outOfRange: c.out,
          halfHoles: c.difficulty / 3,
          // Small preference for the common Alto C / G / F instruments.
          cost: c.cost + (voice === 'alto' ? 0 : 2) + COMMON_KEYS.indexOf(key) * 0.3,
        });
      }
    }
  }
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, opts.limit ?? 10);
}
