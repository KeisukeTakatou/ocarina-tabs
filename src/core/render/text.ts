// Plain-text tabs — easy to read in a terminal, paste into chat, or parse back.

import { Arrangement } from '../arrange.ts';
import { cleanHoles, InstrumentDef } from '../instruments.ts';
import { midiToName } from '../pitch.ts';
import { describeArrangement, durationLabel, NameMode } from './sheet.ts';

export function groupHoles(inst: InstrumentDef, holes: string, symbols = { X: '●', O: '○', H: '◐' }): string {
  const s = cleanHoles(holes);
  return inst.groups.map((g) => g.map((i) => symbols[s[i] as 'X' | 'O' | 'H'] ?? '?').join('')).join(' ');
}

export function holeLegend(inst: InstrumentDef): string {
  return inst.groups.map((g) => g.map((i) => inst.holes[i].id).join(' ')).join(' | ');
}

export interface TextOptions {
  names?: NameMode;
  /** "unicode" (●○◐) or "ascii" (X O H). */
  symbols?: 'unicode' | 'ascii';
}

export function renderText(arr: Arrangement, inst: InstrumentDef, opts: TextOptions = {}): string {
  const sym = opts.symbols === 'ascii' ? { X: 'X', O: 'O', H: 'H' } : { X: '●', O: '○', H: '◐' };
  const names = opts.names ?? 'concert';
  const lines: string[] = [];
  lines.push(arr.title ? `${arr.title}` : 'Untitled');
  if (arr.composer) lines.push(arr.composer);
  lines.push(describeArrangement(arr));
  lines.push(`Holes: ${holeLegend(inst)}   (${sym.X} covered, ${sym.O} open, ${sym.H} half)`);
  for (const w of arr.warnings) lines.push(`! ${w}`);
  lines.push('');
  const header = names === 'both' ? 'bar  note   reads  beats  fingering' : 'bar  note   beats  fingering';
  lines.push(header);
  let lastMeasure = -1;
  for (const e of arr.events) {
    const bar = e.measure !== lastMeasure ? String(e.measure + 1).padStart(3) : '   ';
    lastMeasure = e.measure;
    const name =
      e.status === 'rest'
        ? 'rest'
        : (names === 'fingering' ? e.fingeringName : e.concertName) ?? (e.sourcePitch !== null ? midiToName(e.sourcePitch) : '?');
    const reads = names === 'both' ? (e.status === 'rest' ? '' : e.fingeringName ?? '').padEnd(7) : '';
    const fing = e.holes ? groupHoles(inst, e.holes, sym) : e.status === 'rest' ? '' : '(not playable)';
    let flag = '';
    if (e.status === 'folded') flag = '  [octave moved]';
    if (e.status === 'out-of-range') flag = `  [out of range: ${midiToName((e.sourcePitch ?? 0) + arr.transpose)}]`;
    if (e.alternatives.length) flag += `  alt: ${e.alternatives.map((a) => groupHoles(inst, a, sym)).join(', ')}`;
    if (e.lyric) flag += `  "${e.lyric}"`;
    lines.push(`${bar}  ${name.padEnd(5)}  ${reads}${durationLabel(e.duration).padEnd(5)}  ${fing}${flag}`.trimEnd());
  }
  return lines.join('\n') + '\n';
}

/** Fingering chart as text. */
export function renderChartText(inst: InstrumentDef, tonic: number, opts: { symbols?: 'unicode' | 'ascii' } = {}): string {
  const sym = opts.symbols === 'ascii' ? { X: 'X', O: 'O', H: 'H' } : { X: '●', O: '○', H: '◐' };
  const flats = [5, 10, 3, 8, 1].includes(((tonic % 12) + 12) % 12);
  const lines = [`${inst.name} — tonic ${midiToName(tonic, flats)}`, `Holes: ${holeLegend(inst)}`, ''];
  for (const f of inst.fingerings) {
    lines.push(`${midiToName(tonic + f.offset, flats).padEnd(5)} reads ${midiToName(72 + f.offset).padEnd(4)}  ${groupHoles(inst, f.holes, sym)}${f.alt ? '  (alternate)' : ''}`);
  }
  return lines.join('\n') + '\n';
}
