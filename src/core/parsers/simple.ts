// "Note text": a compact, human- and AI-friendly melody format, and the app's editor format.
//
//   title: Ode to Joy
//   tempo: 120
//   time: 4/4
//   E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4. D4/2 D4:2 |
//
// Tokens (whitespace separated):
//   C4 D#5 Bb3     note with octave (C4 = middle C). Without octave ("C D E") the octave
//                  closest to the previous note is used (letter tabs).
//   :2  *2         length in beats (quarter = 1). Also :3/2, :0.5
//   /2  /4         fractions of a beat (eighth, sixteenth)
//   .  ..          dotted / double dotted
//   r  r:2  r/2    rest
//   |              bar line (optional; checked against nothing, used for layout)
//   _              continue the previous note by one beat (C4 _ _ = 3 beats)
//   "word"         lyric for the previous note
//   # comment      to end of line

import { keyPrefersFlats, midiToName, nearestWithPc, parseNoteName, toFraction } from '../pitch.ts';
import { measureStarts, NoteEvent, Score } from '../score.ts';

const HEADER = /^\s*(title|composer|tempo|time|key)\s*:\s*(.*)$/i;

export function parseSimple(src: string): Score {
  const warnings: string[] = [];
  let title: string | undefined;
  let composer: string | undefined;
  let tempo = 120;
  let ts: [number, number] = [4, 4];
  let keyFifths: number | undefined;
  const notes: NoteEvent[] = [];
  const bars: number[] = [0];
  let t = 0;
  let prevPitch = 72; // default reference for octave-less letter tabs (C5)
  let firstNote = true;
  const errors: string[] = [];

  const lines = src.split(/\r?\n/);
  lines.forEach((rawLine, lineNo) => {
    const line = rawLine.replace(/(^|\s)#.*$/, '');
    const h = HEADER.exec(line);
    if (h) {
      const v = h[2].trim();
      switch (h[1].toLowerCase()) {
        case 'title':
          title = v;
          break;
        case 'composer':
          composer = v;
          break;
        case 'tempo':
          tempo = parseFloat(v) || 120;
          break;
        case 'time': {
          const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
          if (m) ts = [parseInt(m[1], 10), parseInt(m[2], 10)];
          break;
        }
        case 'key': {
          const p = parseNoteName(v.replace(/\s*(major|maj)$/i, ''));
          if (p) keyFifths = keyPrefersFlats(p.pc) ? -1 : 0;
          break;
        }
      }
      return;
    }
    const tokens = line.match(/"[^"]*"|\S+/g) ?? [];
    for (const tok of tokens) {
      if (tok.startsWith('"')) {
        const last = [...notes].reverse().find((n) => n.pitch !== null);
        if (last) last.lyric = tok.slice(1, -1);
        continue;
      }
      if (/^\|+[\]:]*$|^:?\|+:?$/.test(tok)) {
        if (Math.abs(bars[bars.length - 1] - t) > 1e-6) bars.push(t);
        continue;
      }
      if (tok === '_' || tok === '-') {
        const last = notes[notes.length - 1];
        if (last) last.duration += 1;
        t += 1;
        continue;
      }
      const m = /^([A-Ga-g](?:#|b|♯|♭|x){0,2}-?\d*|[rR])((?:[:*](?:\d+\/\d+|\d*\.?\d+))?)((?:\/\d+)?)(\.{0,2})$/.exec(tok);
      if (!m) {
        errors.push(`line ${lineNo + 1}: cannot read "${tok}"`);
        continue;
      }
      let dur = 1;
      if (m[2]) {
        const v = m[2].slice(1);
        const f = /^(\d+)\/(\d+)$/.exec(v);
        dur = f ? parseInt(f[1], 10) / parseInt(f[2], 10) : parseFloat(v);
      }
      if (m[3]) dur /= parseInt(m[3].slice(1), 10);
      if (m[4] === '.') dur *= 1.5;
      if (m[4] === '..') dur *= 1.75;
      if (!(dur > 0)) {
        errors.push(`line ${lineNo + 1}: bad length in "${tok}"`);
        continue;
      }
      if (/^[rR]$/.test(m[1])) {
        notes.push({ pitch: null, start: t, duration: dur });
      } else {
        const p = parseNoteName(m[1]);
        if (!p) {
          errors.push(`line ${lineNo + 1}: bad note "${m[1]}"`);
          continue;
        }
        let pitch: number;
        if (p.octave !== null) pitch = (p.octave + 1) * 12 + p.semitones;
        else pitch = firstNote ? nearestWithPc(p.semitones, 72) : nearestWithPc(p.semitones, prevPitch);
        prevPitch = pitch;
        firstNote = false;
        notes.push({ pitch, start: t, duration: dur });
      }
      t += dur;
    }
  });

  if (errors.length) {
    const shown = errors.slice(0, 5).join('; ');
    warnings.push(`Skipped ${errors.length} unreadable token(s): ${shown}${errors.length > 5 ? ' …' : ''}`);
  }
  if (bars.length > 1 && Math.abs(bars[bars.length - 1] - t) < 1e-6) bars.pop();

  // Only keep explicit bar lines if the text actually had them.
  const hadBars = bars.length > 1;
  return {
    title,
    composer,
    tempo,
    timeSignature: ts,
    keyFifths,
    notes,
    bars: hadBars ? bars : undefined,
    warnings,
  };
}

/** Format a beat length as a note-text suffix. */
export function formatDuration(d: number): string {
  if (Math.abs(d - 1) < 1e-6) return '';
  if (Math.abs(d - 1.5) < 1e-6) return '.';
  if (Math.abs(d - 1.75) < 1e-6) return '..';
  const [n, den] = toFraction(d);
  if (den === 1) return `:${n}`;
  if (n === 1) return `/${den}`;
  if (n === 3 && den % 2 === 0 && den >= 4) return `/${den / 2}.`;
  return `:${n}/${den}`;
}

/** Serialize a score to note text (with bar lines and line breaks every few measures). */
export function scoreToSimple(score: Score, opts: { measuresPerLine?: number } = {}): string {
  const out: string[] = [];
  if (score.title) out.push(`title: ${score.title}`);
  if (score.composer) out.push(`composer: ${score.composer}`);
  out.push(`tempo: ${Math.round(score.tempo)}`);
  out.push(`time: ${score.timeSignature[0]}/${score.timeSignature[1]}`);
  out.push('');
  const flats = score.keyFifths !== undefined && score.keyFifths < 0;
  const bars = measureStarts(score);
  const perLine = opts.measuresPerLine ?? 4;
  let line: string[] = [];
  let measureTokens: string[] = [];
  let bi = 0;
  let measuresOnLine = 0;
  const flushMeasure = () => {
    if (!measureTokens.length) return;
    line.push(measureTokens.join(' '));
    measureTokens = [];
    measuresOnLine++;
    if (measuresOnLine >= perLine) {
      out.push(line.join(' | ') + ' |');
      line = [];
      measuresOnLine = 0;
    }
  };
  for (const n of score.notes) {
    while (bi + 1 < bars.length && n.start >= bars[bi + 1] - 1e-6) {
      flushMeasure();
      bi++;
    }
    const name = n.pitch === null ? 'r' : midiToName(n.pitch, flats);
    let tok = name + formatDuration(n.duration);
    if (n.lyric) tok += ` "${n.lyric.replace(/"/g, "'")}"`;
    measureTokens.push(tok);
  }
  flushMeasure();
  if (line.length) out.push(line.join(' | ') + ' |');
  return out.join('\n') + '\n';
}
