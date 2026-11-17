// Pitch helpers. Pitches are MIDI note numbers (C4 = 60, A4 = 69).

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** "C#5", "Bb4". */
export function midiToName(midi: number, preferFlats = false, withOctave = true): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const name = names[pitchClass(midi)];
  return withOctave ? `${name}${octaveOf(midi)}` : name;
}

export interface ParsedNoteName {
  pc: number; // pitch class including accidental, 0..11 (may wrap)
  semitones: number; // letter pc + accidental offset (can be -1 or 12 for Cb / B#)
  octave: number | null;
}

/**
 * Parse note names like "C", "c#", "Bb4", "F##3", "E♭5", "Cb4".
 * Lowercase "b" directly after the letter is treated as a flat ("bb4" = Bb4).
 */
export function parseNoteName(text: string): ParsedNoteName | null {
  const m = /^([A-Ga-g])((?:#|b|♯|♭|x){0,2})(-?\d+)?$/.exec(text.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  let acc = 0;
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') acc += 1;
    else if (ch === 'x') acc += 2;
    else acc -= 1;
  }
  const semitones = LETTER_PC[letter] + acc;
  return { pc: ((semitones % 12) + 12) % 12, semitones, octave: m[3] !== undefined ? parseInt(m[3], 10) : null };
}

/** Parse a full note name with octave into MIDI. Returns null when invalid or octave missing. */
export function nameToMidi(text: string): number | null {
  const p = parseNoteName(text);
  if (!p || p.octave === null) return null;
  return (p.octave + 1) * 12 + p.semitones;
}

/** Midi pitch with given pitch-class semitones closest to `near`. */
export function nearestWithPc(semitones: number, near: number): number {
  const pc = ((semitones % 12) + 12) % 12;
  let best = near - pitchClass(near) + pc;
  if (best - near > 6) best -= 12;
  if (near - best > 6) best += 12;
  return best;
}

export function letterPc(letter: string): number {
  return LETTER_PC[letter.toUpperCase()];
}

/** Key signature (circle-of-fifths count) for a major key tonic pitch class. */
export function majorKeyFifths(pc: number, preferFlats = false): number {
  const sharpKeys: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7 };
  const flatKeys: Record<number, number> = { 0: 0, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5, 6: -6, 11: -7 };
  if (preferFlats && flatKeys[pc] !== undefined) return flatKeys[pc];
  if (sharpKeys[pc] !== undefined && !(pc === 1 || pc === 6)) return sharpKeys[pc];
  return flatKeys[pc] ?? sharpKeys[pc] ?? 0;
}

/** Fraction helpers for readable durations. */
export function toFraction(x: number, maxDen = 48): [number, number] {
  let best: [number, number] = [Math.round(x), 1];
  let bestErr = Math.abs(x - best[0]);
  for (let den = 2; den <= maxDen; den++) {
    const num = Math.round(x * den);
    const err = Math.abs(x - num / den);
    if (err < bestErr - 1e-9) {
      best = [num, den];
      bestErr = err;
    }
  }
  const g = gcd(Math.abs(best[0]), best[1]) || 1;
  return [best[0] / g, best[1] / g];
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

const FLAT_KEY_PCS = new Set([5, 10, 3, 8, 1]);

/** Whether a major key on this tonic is conventionally spelled with flats (F, Bb, Eb, Ab, Db). */
export function keyPrefersFlats(tonic: number): boolean {
  return FLAT_KEY_PCS.has(pitchClass(tonic));
}
