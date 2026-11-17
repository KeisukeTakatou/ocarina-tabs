// One entry point for every input format.

import { Score } from '../score.ts';
import { listAbcTunes, looksLikeAbc, parseAbc } from './abc.ts';
import { describeMidiTracks, guessMelodyTrack, isMidi, midiToScore, MidiTrackInfo, parseMidi } from './midi.ts';
import { listMusicXmlParts, looksLikeMusicXml, MusicXmlPartInfo, parseMusicXml } from './musicxml.ts';
import { parseSimple } from './simple.ts';
import { extractMxl, isZip } from './zip.ts';

export type InputFormat = 'midi' | 'musicxml' | 'mxl' | 'abc' | 'text';

export interface ImportOptions {
  format?: InputFormat;
  /** MIDI track index, "auto" or "all". */
  track?: number | 'auto' | 'all';
  /** MIDI channel filter. */
  channel?: number;
  /** MusicXML part (index or id). */
  part?: number | string;
  /** MusicXML staff number (piano: 1 = right hand). */
  staff?: number;
  /** ABC tune index in multi-tune files. */
  tune?: number;
}

export interface ImportResult {
  format: InputFormat;
  score: Score;
  /** Selectable sub-sources, so a UI can offer a choice. */
  midiTracks?: MidiTrackInfo[];
  selectedTrack?: number;
  musicXmlParts?: MusicXmlPartInfo[];
  abcTunes?: { index: number; title: string }[];
}

export function detectFormat(name: string | undefined, data: Uint8Array | string): InputFormat {
  const ext = (name ?? '').toLowerCase().split('.').pop() ?? '';
  if (ext === 'mid' || ext === 'midi' || ext === 'kar' || ext === 'rmi') return 'midi';
  if (ext === 'mxl') return 'mxl';
  if (ext === 'musicxml' || ext === 'xml') return 'musicxml';
  if (ext === 'abc') return 'abc';
  if (typeof data !== 'string') {
    if (isMidi(data) || (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46)) return 'midi';
    if (isZip(data)) return 'mxl';
  }
  const txt = typeof data === 'string' ? data : new TextDecoder().decode(data.subarray(0, 8000));
  if (looksLikeMusicXml(txt)) return 'musicxml';
  if (looksLikeAbc(txt)) return 'abc';
  return 'text';
}

function asText(data: Uint8Array | string): string {
  if (typeof data === 'string') return data;
  // Handle UTF-16 BOMs that some notation programs write.
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
  return new TextDecoder().decode(data);
}

/** Import any supported file. `name` is used for format detection by extension. */
export async function importMusic(data: Uint8Array | string, name?: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const format = opts.format ?? detectFormat(name, data);
  switch (format) {
    case 'midi': {
      if (typeof data === 'string') throw new Error('MIDI input must be binary');
      const midi = parseMidi(data);
      const selected = typeof opts.track === 'number' ? opts.track : guessMelodyTrack(midi);
      const score = midiToScore(midi, { track: opts.track ?? 'auto', channel: opts.channel, title: stripExt(name) });
      if (!score.title) score.title = stripExt(name);
      return { format, score, midiTracks: describeMidiTracks(midi), selectedTrack: opts.track === 'all' ? undefined : selected };
    }
    case 'mxl': {
      if (typeof data === 'string') throw new Error('.mxl input must be binary');
      const xml = await extractMxl(data);
      const score = parseMusicXml(xml, { part: opts.part, staff: opts.staff });
      score.title ??= stripExt(name);
      return { format, score, musicXmlParts: listMusicXmlParts(xml) };
    }
    case 'musicxml': {
      const xml = asText(data);
      const score = parseMusicXml(xml, { part: opts.part, staff: opts.staff });
      score.title ??= stripExt(name);
      return { format, score, musicXmlParts: listMusicXmlParts(xml) };
    }
    case 'abc': {
      const txt = asText(data);
      const score = parseAbc(txt, { tune: opts.tune });
      score.title ??= stripExt(name);
      const tunes = listAbcTunes(txt);
      return { format, score, abcTunes: tunes.length > 1 ? tunes : undefined };
    }
    default: {
      const score = parseSimple(asText(data));
      score.title ??= stripExt(name);
      return { format: 'text', score };
    }
  }
}

function stripExt(name?: string): string | undefined {
  if (!name || name === '-') return undefined;
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, '');
}
