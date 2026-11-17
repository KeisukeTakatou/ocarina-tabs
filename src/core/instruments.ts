// Ocarina definitions: hole layout (for drawing) + fingering chart.
//
// Fingering strings list one character per hole, in the order of `holes`:
//   X = covered, O = open, H = half-covered. Spaces are ignored (used for grouping).
// `offset` is semitones above the ocarina's tonic (the note the chart calls "C";
// on a G ocarina that sounds G). Charts are written for a C instrument.
//
// Sources: standard Japanese-system 12-hole transverse chart (low A to high F) and the
// English (John Taylor) pendant system for 4 and 6 holes. Makers differ slightly — a custom
// chart can be supplied as JSON with the same shape (see README).

import { keyPrefersFlats, midiToName, parseNoteName } from './pitch.ts';

export type HoleState = 'X' | 'O' | 'H';

export interface HoleDef {
  id: string;
  label: string;
  /** Position/size in the instrument's drawing viewBox. */
  x: number;
  y: number;
  r: number;
  /** Back-side (thumb) holes are drawn dashed. */
  back?: boolean;
}

export interface FingeringDef {
  offset: number;
  holes: string;
  /** Alternate fingering (shown as an alternative, never chosen first). */
  alt?: boolean;
  comment?: string;
}

export interface InstrumentDef {
  id: string;
  name: string;
  description: string;
  holes: HoleDef[];
  fingerings: FingeringDef[];
  drawing: DrawingDef;
  /** Groups of hole indices, used for compact text output, e.g. [[0,1,2,3],[4,5,6,7],...]. */
  groups: number[][];
}

export interface DrawingDef {
  viewBox: [number, number];
  /** SVG path(s) for the body outline. */
  body: string;
  /** Default diagram width on the tab sheet, in px (default 80 for wide drawings, 54 otherwise). */
  size?: number;
  /** Body outline width in viewBox units (default 1.4). */
  stroke?: number;
  /** Hole outline width (default 1.3, 0.9 for tiny holes). */
  holeStroke?: number;
  /** 'ink': outline in the covered-hole colour, body left unfilled on a paper card (picture style). Default 'soft'. */
  look?: 'soft' | 'ink';
}

const TWELVE_HOLE: InstrumentDef = {
  id: '12',
  name: '12-hole transverse',
  description: 'Japanese-system 12-hole transverse (Alto/Soprano/Bass). Range: A below the tonic up to the 11th above (21 notes, e.g. A4–F6 on an Alto C).',
  holes: [
    // Positions traced from the 12c_note picture set (198 × 166 px); thumbs sit below the body outline.
    { id: 'L1', label: 'Left index', x: 29.4, y: 104, r: 9.2 },
    { id: 'L2', label: 'Left middle', x: 50.9, y: 94.4, r: 9.2 },
    { id: 'L3', label: 'Left ring', x: 66, y: 79.1, r: 9.2 },
    { id: 'L4', label: 'Left pinky', x: 75.7, y: 58.4, r: 9.2 },
    { id: 'R1', label: 'Right index', x: 111.9, y: 89.2, r: 9.2 },
    { id: 'R2', label: 'Right middle', x: 120.9, y: 67.3, r: 9.2 },
    { id: 'R3', label: 'Right ring', x: 137.1, y: 49.9, r: 9.2 },
    { id: 'R4', label: 'Right pinky', x: 156, y: 38, r: 9.2 },
    { id: 'LT', label: 'Left thumb', x: 68.1, y: 149.9, r: 9.2, back: true },
    { id: 'RT', label: 'Right thumb', x: 133.7, y: 128.1, r: 9.2, back: true },
    { id: 'LS', label: 'Left sub-hole', x: 63.9, y: 109.6, r: 5.8 },
    { id: 'RS', label: 'Right sub-hole', x: 105.6, y: 55, r: 5.8 },
  ],
  groups: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9], [10, 11]],
  drawing: {
    viewBox: [198, 166],
    body: 'M184,2.2 C182,2.2 181.7,2 176.9,3.2 C172.1,4.4 163.9,6.5 155,9.3 C146.1,12.1 136.4,14.6 123.4,19.8 C110.4,25 88.8,34.9 77.1,40.6 C65.5,46.3 62.3,48.1 53.7,54.1 C45,60.1 32,70.8 25.2,76.7 C18.4,82.5 15.8,85.7 12.7,89.2 C9.5,92.7 7.8,95.1 6.1,97.7 C4.5,100.3 3.7,102.4 3,104.7 C2.4,107.1 1.8,108.6 2.4,111.8 C3.1,114.9 5.2,120.7 7,123.5 C8.7,126.4 10.6,127.4 12.8,128.8 C15,130.1 17,131 20.2,131.6 C23.4,132.1 25.9,132.2 32,131.9 C38.1,131.6 50.4,130.1 57.1,129.9 C63.7,129.7 68.7,130.2 71.9,130.7 C75.1,131.3 74.8,132 76.4,133.1 C77.9,134.2 78.5,133.7 81.1,137.4 C83.7,141.1 89.5,151.6 92.1,155.4 C94.6,159.2 94.4,158.9 96.4,160.1 C98.4,161.3 101.9,162.4 104,162.7 C106.2,163 107.9,162.4 109.4,162.1 C110.9,161.7 111.8,161.6 112.9,160.4 C113.9,159.2 114.7,161.3 115.7,154.9 C116.6,148.5 116.6,130.6 118.7,122.1 C120.8,113.5 124,110.6 128,103.5 C132.1,96.5 133.6,92.1 143.1,79.6 C152.6,67.1 176.8,38.9 185.1,28.6 C193.3,18.3 191,20.6 192.5,17.9 C193.9,15.1 193.7,13.9 193.7,12 C193.7,10 193.2,7.6 192.5,6.1 C191.7,4.6 190.6,3.8 189.2,3.2 C187.8,2.5 186,2.2 184,2.2 Z',
    size: 84,
    stroke: 3.2,
    holeStroke: 1.2,
    look: 'ink',
  },
  fingerings: [
    { offset: -3, holes: 'XXXX XXXX XX XX' },
    { offset: -2, holes: 'XXXX XXXX XX XO' },
    { offset: -1, holes: 'XXXX XXXX XX OX' },
    { offset: 0, holes: 'XXXX XXXX XX OO' },
    { offset: 1, holes: 'XXXX XXXO XX OX' },
    { offset: 2, holes: 'XXXX XXXO XX OO' },
    { offset: 3, holes: 'XXXX XXOO XX OX' },
    { offset: 3, holes: 'XXXX XOXO XX OO', alt: true },
    { offset: 4, holes: 'XXXX XXOO XX OO' },
    { offset: 5, holes: 'XXXX XOOO XX OO' },
    { offset: 6, holes: 'XXXX OOXO XX OO' },
    { offset: 7, holes: 'XXXX OOOO XX OO' },
    { offset: 8, holes: 'XXOX OOXO XX OO' },
    { offset: 9, holes: 'XXOX OOOO XX OO' },
    { offset: 10, holes: 'XOOX OOXO XX OO' },
    { offset: 10, holes: 'OXOX OOOO XX OO', alt: true },
    { offset: 11, holes: 'XOOX OOOO XX OO' },
    { offset: 12, holes: 'OOOX OOOO XX OO' },
    // C#6 and D#6: L4 + R3, as in the 12c_note picture set; L1 + L4 (alt) is the other common choice.
    { offset: 13, holes: 'OOOX OOXO OX OO' },
    { offset: 13, holes: 'XOOX OOOO OX OO', alt: true },
    { offset: 14, holes: 'OOOX OOOO OX OO' },
    { offset: 15, holes: 'OOOX OOXO OO OO' },
    { offset: 15, holes: 'XOOX OOOO OO OO', alt: true },
    { offset: 16, holes: 'OOOX OOOO OO OO' },
    { offset: 17, holes: 'OOOO OOOO OO OO' },
  ],
};

// Pendant layout as seen from the front, windway at the bottom.
const PENDANT_FRONT: HoleDef[] = [
  { id: 'L1', label: 'Left upper', x: 34, y: 36, r: 9 },
  { id: 'L2', label: 'Left lower', x: 34, y: 62, r: 10 },
  { id: 'R1', label: 'Right upper (small)', x: 66, y: 36, r: 6.2 },
  { id: 'R2', label: 'Right lower', x: 66, y: 62, r: 7.6 },
];
const PENDANT_BODY = 'M50,8 C78,8 94,28 94,50 C94,68 82,80 66,86 L60,96 L40,96 L34,86 C18,80 6,68 6,50 C6,28 22,8 50,8 Z';

const PENDANT_CHART: FingeringDef[] = [
  { offset: 0, holes: 'XX XX' },
  { offset: 1, holes: 'XX HX' },
  { offset: 2, holes: 'XX OX' },
  { offset: 3, holes: 'XX XH' },
  { offset: 4, holes: 'XX XO' },
  { offset: 5, holes: 'XX OO' },
  { offset: 6, holes: 'OX XX' },
  { offset: 7, holes: 'OX OX' },
  { offset: 8, holes: 'OX XO' },
  { offset: 9, holes: 'OX OO' },
  { offset: 10, holes: 'OO OX' },
  { offset: 11, holes: 'OO XO' },
  { offset: 12, holes: 'OO OO' },
];

const FOUR_HOLE: InstrumentDef = {
  id: '4',
  name: '4-hole pendant',
  description: 'English-system 4-hole pendant. Range: one chromatic octave (13 notes, tonic to tonic).',
  holes: PENDANT_FRONT,
  groups: [[0, 1], [2, 3]],
  drawing: { viewBox: [100, 100], body: PENDANT_BODY },
  fingerings: PENDANT_CHART,
};

const SIX_HOLE: InstrumentDef = {
  id: '6',
  name: '6-hole pendant',
  description: 'English-system 6-hole pendant (4 front + 2 thumb holes). Range: tonic up to the 10th (17 notes, C–E).',
  holes: [
    ...PENDANT_FRONT,
    { id: 'LT', label: 'Left thumb', x: 12, y: 90, r: 6, back: true },
    { id: 'RT', label: 'Right thumb', x: 88, y: 90, r: 6, back: true },
  ],
  groups: [[0, 1], [2, 3], [4, 5]],
  drawing: { viewBox: [100, 100], body: PENDANT_BODY },
  fingerings: [
    ...PENDANT_CHART.map((f) => ({ ...f, holes: `${f.holes} XX` })),
    { offset: 13, holes: 'OO XO XO' },
    { offset: 14, holes: 'OO OO XO' },
    { offset: 15, holes: 'OO XO OO' },
    { offset: 16, holes: 'OO OO OO' },
  ],
};

export const INSTRUMENTS: InstrumentDef[] = [FOUR_HOLE, SIX_HOLE, TWELVE_HOLE];

const customInstruments = new Map<string, InstrumentDef>();

/** Register a user-supplied instrument (e.g. a maker-specific chart). Validates it. */
export function registerInstrument(def: InstrumentDef): InstrumentDef {
  const errors = validateInstrument(def);
  if (errors.length) throw new Error(`Invalid instrument "${def.id}": ${errors.join('; ')}`);
  customInstruments.set(def.id, def);
  return def;
}

export function validateInstrument(def: InstrumentDef): string[] {
  const errs: string[] = [];
  if (!def || typeof def !== 'object') return ['not an object'];
  if (!def.id) errs.push('missing id');
  if (!Array.isArray(def.holes) || !def.holes.length) errs.push('missing holes');
  if (!Array.isArray(def.fingerings) || !def.fingerings.length) errs.push('missing fingerings');
  if (errs.length) return errs;
  for (const f of def.fingerings) {
    const s = cleanHoles(f.holes);
    if (s.length !== def.holes.length) errs.push(`offset ${f.offset}: ${s.length} holes, expected ${def.holes.length}`);
    if (/[^XOH]/.test(s)) errs.push(`offset ${f.offset}: use only X, O, H`);
  }
  return errs;
}

export function listInstruments(): InstrumentDef[] {
  return [...INSTRUMENTS, ...customInstruments.values()];
}

/** Accepts "4", "4-hole", "6h", "12", "12-hole", or a custom id. */
export function getInstrument(id: string | number): InstrumentDef {
  const key = String(id).toLowerCase().replace(/[\s_-]*(hole|holes|h)$/, '');
  const found = customInstruments.get(String(id)) ?? listInstruments().find((i) => i.id === key || i.id === String(id));
  if (!found) throw new Error(`Unknown instrument "${id}". Available: ${listInstruments().map((i) => i.id).join(', ')}`);
  return found;
}

export function cleanHoles(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

export function offsetRange(inst: InstrumentDef): [number, number] {
  const offs = inst.fingerings.map((f) => f.offset);
  return [Math.min(...offs), Math.max(...offs)];
}

/** Primary + alternate fingerings for a semitone offset above the tonic. */
export function fingeringsFor(inst: InstrumentDef, offset: number): FingeringDef[] {
  const list = inst.fingerings.filter((f) => f.offset === offset);
  return list.sort((a, b) => Number(!!a.alt) - Number(!!b.alt));
}

/** Rough playing difficulty of a fingering (0 = easy). Used to choose transpositions. */
export function fingeringDifficulty(holes: string): number {
  const s = cleanHoles(holes);
  return (s.match(/H/g)?.length ?? 0) * 3;
}

// ---------------------------------------------------------------------------
// Ocarina tuning: which pitch is the instrument's "C" fingering?

export type Voice = 'soprano' | 'alto' | 'bass';
export const VOICES: Voice[] = ['soprano', 'alto', 'bass'];
export const COMMON_KEYS = ['C', 'G', 'F', 'D', 'Bb', 'A', 'E', 'Eb', 'Ab', 'Db', 'B', 'F#'];

/**
 * Resolve the MIDI pitch of the tonic ("C" fingering).
 *  - `key` like "G" plus a voice: Alto tonics lie between F4 and E5 (Alto C = C5,
 *    Alto G = G4, Alto F = F4), Soprano is an octave higher, Bass an octave lower.
 *  - `key` with an octave ("G4") is used as-is and the voice is ignored.
 */
export function resolveTonic(key: string, voice: Voice = 'alto'): number {
  const p = parseNoteName(key);
  if (!p) throw new Error(`Invalid key "${key}" (use e.g. C, G, Bb, F#, or with octave: G4)`);
  if (p.octave !== null) return (p.octave + 1) * 12 + p.semitones;
  // Alto window: F4 (65) .. E5 (76)
  let tonic = 60 + p.pc;
  if (tonic < 65) tonic += 12;
  if (voice === 'soprano') tonic += 12;
  if (voice === 'bass') tonic -= 12;
  return tonic;
}

export interface OcarinaSpec {
  instrument: InstrumentDef;
  tonic: number;
}

export function describeOcarina(spec: OcarinaSpec): string {
  const [lo, hi] = offsetRange(spec.instrument);
  const flats = keyPrefersFlats(spec.tonic);
  return `${spec.instrument.name} in ${midiToName(spec.tonic, flats, false)} (tonic ${midiToName(spec.tonic, flats)}, range ${midiToName(spec.tonic + lo, flats)}–${midiToName(spec.tonic + hi, flats)})`;
}
