// Common, format-independent melody representation.
// Times and durations are measured in quarter-note beats.

export interface NoteEvent {
  /** MIDI pitch (concert pitch), or null for a rest. */
  pitch: number | null;
  start: number;
  duration: number;
  lyric?: string;
}

export interface Score {
  title?: string;
  composer?: string;
  /** Quarter-note beats per minute. */
  tempo: number;
  timeSignature: [number, number];
  /** Key signature in fifths (-7..7), if known. Used for sharp/flat spelling. */
  keyFifths?: number;
  /** Monophonic, time-ordered events (rests included). */
  notes: NoteEvent[];
  /** Start beat of every measure, when the source format knows them (pickup bars etc.). */
  bars?: number[];
  /** Notes about lossy conversions (chords reduced, repeats not expanded, ...). */
  warnings: string[];
}

const EPS = 1e-6;

export function beatsPerMeasure(ts: [number, number]): number {
  return (ts[0] * 4) / ts[1];
}

/**
 * Reduce possibly-polyphonic notes to a single melodic line ("skyline": the highest
 * sounding note wins at each onset), then insert explicit rests for gaps.
 */
export function toMonophonic(input: NoteEvent[], warnings?: string[]): NoteEvent[] {
  const notes = input
    .filter((n) => n.pitch !== null && n.duration > EPS)
    .slice()
    .sort((a, b) => a.start - b.start || (b.pitch as number) - (a.pitch as number));

  const out: NoteEvent[] = [];
  let reduced = 0;
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.start - n.start) < EPS) {
      reduced++; // same onset, lower pitch -> dropped (chord)
      continue;
    }
    if (prev && prev.start + prev.duration > n.start + EPS) {
      // Overlap: the new onset cuts the previous note short.
      prev.duration = n.start - prev.start;
    }
    out.push({ ...n });
  }
  if (reduced && warnings) warnings.push(`${reduced} chord/harmony note(s) dropped; kept the highest note at each onset.`);
  return fillRests(out);
}

/** Insert rest events into gaps between notes. Assumes sorted, non-overlapping input. */
export function fillRests(notes: NoteEvent[], startAt = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  let t = startAt;
  for (const n of notes) {
    if (n.pitch === null) continue;
    if (n.start - t > 1e-3) out.push({ pitch: null, start: t, duration: n.start - t });
    out.push(n);
    t = n.start + n.duration;
  }
  return out;
}

/** Start beats of all measures covering the score. */
export function measureStarts(score: Score): number[] {
  const end = score.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  if (score.bars && score.bars.length) {
    const bars = score.bars.slice();
    const bpm = beatsPerMeasure(score.timeSignature);
    while (bars[bars.length - 1] + bpm < end - EPS) bars.push(bars[bars.length - 1] + bpm);
    return bars;
  }
  const bpm = beatsPerMeasure(score.timeSignature);
  const out: number[] = [];
  for (let t = 0; t < end - EPS || out.length === 0; t += bpm) out.push(t);
  return out;
}

/** Index of the measure containing beat `t`. */
export function measureIndexAt(bars: number[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid] <= t + EPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function pitchRange(score: Score): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of score.notes) {
    if (n.pitch === null) continue;
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  return lo === Infinity ? null : [lo, hi];
}

export function emptyScore(): Score {
  return { tempo: 120, timeSignature: [4, 4], notes: [], warnings: [] };
}
