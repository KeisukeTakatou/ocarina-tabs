// MusicXML (score-partwise) → Score. Also reads compressed .mxl via ./zip.ts.

import { letterPc } from '../pitch.ts';
import { NoteEvent, Score, toMonophonic } from '../score.ts';
import { child, elements, findFirst, num, parseXml, path, text, XmlElement } from './xml.ts';

export interface MusicXmlPartInfo {
  index: number;
  id: string;
  name: string;
  notes: number;
}

export interface MusicXmlOptions {
  /** Part index (0-based) or part id. Default: first part with notes. */
  part?: number | string;
  /** Staff number for multi-staff parts (piano). Default 1. */
  staff?: number;
  /** Voice to keep. Default: all voices on the staff (top line wins). */
  voice?: string;
}

export function looksLikeMusicXml(textContent: string): boolean {
  return /<score-(partwise|timewise)[\s>]/.test(textContent.slice(0, 5000));
}

function getRoot(xml: string): XmlElement {
  const doc = parseXml(xml);
  const root = elements(doc).find((e) => e.name === 'score-partwise' || e.name === 'score-timewise');
  if (!root) throw new Error('Not a MusicXML score (no <score-partwise>)');
  if (root.name === 'score-timewise') return timewiseToPartwise(root);
  return root;
}

export function listMusicXmlParts(xml: string): MusicXmlPartInfo[] {
  const root = getRoot(xml);
  const names = partNames(root);
  return elements(root, 'part').map((p, index) => ({
    index,
    id: p.attrs.id ?? String(index),
    name: names[p.attrs.id] ?? `Part ${index + 1}`,
    notes: elements(p, 'measure').reduce((s, m) => s + elements(m, 'note').filter((n) => !child(n, 'rest')).length, 0),
  }));
}

function partNames(root: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sp of elements(child(root, 'part-list'), 'score-part')) out[sp.attrs.id] = text(child(sp, 'part-name'));
  return out;
}

export function parseMusicXml(xml: string, opts: MusicXmlOptions = {}): Score {
  const root = getRoot(xml);
  const parts = elements(root, 'part');
  if (!parts.length) throw new Error('MusicXML has no parts');
  let part: XmlElement | undefined;
  if (typeof opts.part === 'number') part = parts[opts.part];
  else if (typeof opts.part === 'string') part = parts.find((p) => p.attrs.id === opts.part);
  else part = parts.find((p) => findFirst(p, 'pitch')) ?? parts[0];
  if (!part) throw new Error(`Part ${opts.part} not found (score has ${parts.length} parts)`);

  const warnings: string[] = [];
  if (parts.length > 1 && opts.part === undefined) {
    const names = partNames(root);
    warnings.push(`Using part "${names[part.attrs.id] ?? part.attrs.id}" (${parts.indexOf(part) + 1} of ${parts.length}); another part can be chosen.`);
  }
  const wantStaff = String(opts.staff ?? 1);

  let divisions = 1;
  let transpose = 0;
  let tempo: number | undefined;
  let timeSig: [number, number] | undefined;
  let keyFifths: number | undefined;
  let pos = 0;
  const bars: number[] = [];
  const notes: (NoteEvent & { tieStop?: boolean; tieStart?: boolean })[] = [];
  let lastStart = 0;
  let hasRepeats = false;

  for (const measure of elements(part, 'measure')) {
    const measureStart = pos;
    let maxPos = pos;
    bars.push(measureStart);
    for (const el of elements(measure)) {
      switch (el.name) {
        case 'attributes': {
          const d = child(el, 'divisions');
          if (d) divisions = num(d, 1) || 1;
          const k = path(el, 'key', 'fifths');
          if (k && keyFifths === undefined) keyFifths = num(k);
          const tm = child(el, 'time');
          if (tm && !timeSig) timeSig = [num(child(tm, 'beats'), 4), num(child(tm, 'beat-type'), 4)];
          const tr = child(el, 'transpose');
          if (tr) transpose = num(child(tr, 'chromatic')) + 12 * num(child(tr, 'octave-change'));
          break;
        }
        case 'direction':
        case 'sound': {
          const snd = el.name === 'sound' ? el : child(el, 'sound');
          if (snd?.attrs.tempo && tempo === undefined) tempo = parseFloat(snd.attrs.tempo);
          if (tempo === undefined && el.name === 'direction') {
            const pm = findFirst(el, 'per-minute');
            if (pm) tempo = num(pm) || undefined;
          }
          break;
        }
        case 'backup':
          pos -= num(child(el, 'duration')) / divisions;
          break;
        case 'forward':
          pos += num(child(el, 'duration')) / divisions;
          maxPos = Math.max(maxPos, pos);
          break;
        case 'barline':
          if (child(el, 'repeat') || child(el, 'ending')) hasRepeats = true;
          break;
        case 'note': {
          if (child(el, 'grace') || child(el, 'cue')) break;
          const isChord = !!child(el, 'chord');
          const dur = num(child(el, 'duration')) / divisions;
          const start = isChord ? lastStart : pos;
          if (!isChord) {
            lastStart = pos;
            pos += dur;
            maxPos = Math.max(maxPos, pos);
          }
          const staff = text(child(el, 'staff')) || '1';
          const voice = text(child(el, 'voice')) || '1';
          if (staff !== wantStaff) break;
          if (opts.voice !== undefined && voice !== opts.voice) break;
          const pitchEl = child(el, 'pitch');
          if (!pitchEl) break; // rest or unpitched
          const step = text(child(pitchEl, 'step'));
          const alter = num(child(pitchEl, 'alter'));
          const octave = num(child(pitchEl, 'octave'), 4);
          const midi = (octave + 1) * 12 + letterPc(step) + Math.round(alter) + transpose;
          const ties = elements(el, 'tie').map((t) => t.attrs.type);
          const lyricText = text(path(el, 'lyric', 'text')) || undefined;
          notes.push({ pitch: midi, start, duration: dur, lyric: lyricText, tieStop: ties.includes('stop'), tieStart: ties.includes('start') });
          break;
        }
      }
    }
    pos = Math.max(pos, maxPos);
  }

  // Merge tied notes.
  const merged: NoteEvent[] = [];
  for (const n of notes.sort((a, b) => a.start - b.start)) {
    if (n.tieStop) {
      const prev = [...merged].reverse().find((m) => m.pitch === n.pitch && Math.abs(m.start + m.duration - n.start) < 1e-6);
      if (prev) {
        prev.duration += n.duration;
        continue;
      }
    }
    merged.push({ pitch: n.pitch, start: n.start, duration: n.duration, lyric: n.lyric });
  }

  if (hasRepeats) warnings.push('Repeat signs / endings are not expanded; the music is read straight through.');

  const work = text(path(root, 'work', 'work-title')) || text(child(root, 'movement-title')) || undefined;
  const creator = elements(child(root, 'identification'), 'creator').find((c) => c.attrs.type === 'composer');
  return {
    title: work,
    composer: creator ? text(creator) : undefined,
    tempo: Math.round(tempo ?? 120),
    timeSignature: timeSig ?? [4, 4],
    keyFifths,
    notes: toMonophonic(merged, warnings),
    bars,
    warnings,
  };
}

/** Convert score-timewise (rare) into a partwise structure. */
function timewiseToPartwise(root: XmlElement): XmlElement {
  const parts = new Map<string, XmlElement>();
  for (const m of elements(root, 'measure')) {
    for (const p of elements(m, 'part')) {
      const id = p.attrs.id;
      if (!parts.has(id)) parts.set(id, { name: 'part', attrs: { id }, children: [] });
      parts.get(id)!.children.push({ name: 'measure', attrs: m.attrs, children: p.children });
    }
  }
  return {
    name: 'score-partwise',
    attrs: {},
    children: [...root.children.filter((c) => typeof c === 'string' || c.name !== 'measure'), ...parts.values()],
  };
}
