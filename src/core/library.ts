// Song library: saved melodies (note text or ABC) with the ocarina settings they were last used with.
// Plain data and pure functions only. The app decides where the JSON lives (localStorage in the browser,
// a file or app storage on Android).

import { parseAbc } from './parsers/abc.ts';
import { parseSimple } from './parsers/simple.ts';
import { midiToName } from './pitch.ts';
import { pitchRange } from './score.ts';

export type LibraryMode = 'text' | 'abc';

/** Ocarina settings saved with a song, so it reopens the way it was arranged. */
export interface LibrarySettings {
  instrument?: string;
  key?: string;
  voice?: string;
  transpose?: string;
  manual?: number;
  oor?: string;
}

export interface LibraryEntry {
  id: string;
  title: string;
  composer?: string;
  /** The melody, as note text or ABC (see `mode`). */
  text: string;
  mode: LibraryMode;
  /** File name it was imported from, if any. */
  source?: string;
  settings?: LibrarySettings;
  /** Cached summary for the list. */
  notes: number;
  range?: string;
  created: number;
  updated: number;
}

export interface LibraryFile {
  app: 'ocarina-tabs';
  kind: 'library';
  version: 1;
  songs: LibraryEntry[];
}

export interface SongSummary {
  title?: string;
  composer?: string;
  notes: number;
  range?: string;
}

/** Title, composer, note count and range of a melody, or zero notes if it can't be read. */
export function summarizeSong(text: string, mode: LibraryMode): SongSummary {
  try {
    const score = mode === 'abc' ? parseAbc(text) : parseSimple(text);
    const r = pitchRange(score);
    return {
      title: score.title,
      composer: score.composer,
      notes: score.notes.filter((n) => n.pitch !== null).length,
      range: r ? `${midiToName(r[0])}–${midiToName(r[1])}` : undefined,
    };
  } catch {
    return { notes: 0 };
  }
}

/** Short random id (no crypto API needed). */
export function newLibraryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Build an entry. The title comes from the melody's own title, then `fallbackTitle` (e.g. the file name). */
export function makeEntry(
  input: { text: string; mode: LibraryMode; source?: string; settings?: LibrarySettings; fallbackTitle?: string; id?: string },
  now = Date.now(),
): LibraryEntry {
  const sum = summarizeSong(input.text, input.mode);
  const fromFile = input.source?.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return {
    id: input.id ?? newLibraryId(),
    title: (sum.title || input.fallbackTitle || fromFile || 'Untitled').trim(),
    composer: sum.composer,
    text: input.text,
    mode: input.mode,
    source: input.source,
    settings: input.settings,
    notes: sum.notes,
    range: sum.range,
    created: now,
    updated: now,
  };
}

/** Insert or replace by id; the result is sorted newest first. Keeps `created` of an existing entry. */
export function upsertEntry(list: LibraryEntry[], entry: LibraryEntry): LibraryEntry[] {
  const old = list.find((e) => e.id === entry.id);
  const next = old ? { ...entry, created: old.created } : entry;
  return sortLibrary([next, ...list.filter((e) => e.id !== entry.id)]);
}

export function removeEntry(list: LibraryEntry[], id: string): LibraryEntry[] {
  return list.filter((e) => e.id !== id);
}

/** An entry with the same melody (ignoring whitespace differences), to avoid saving an import twice. */
export function findDuplicate(list: LibraryEntry[], text: string, mode: LibraryMode): LibraryEntry | undefined {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const t = norm(text);
  return list.find((e) => e.mode === mode && norm(e.text) === t);
}

export function sortLibrary(list: LibraryEntry[]): LibraryEntry[] {
  return [...list].sort((a, b) => b.updated - a.updated);
}

/** Case-insensitive match on title, composer and source file; every word must match. */
export function searchLibrary(list: LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const hay = `${e.title} ${e.composer ?? ''} ${e.source ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function serializeLibrary(list: LibraryEntry[]): string {
  const file: LibraryFile = { app: 'ocarina-tabs', kind: 'library', version: 1, songs: sortLibrary(list) };
  return JSON.stringify(file, null, 2);
}

/**
 * Read a library backup (or the stored library). Accepts the LibraryFile wrapper or a bare array.
 * Invalid songs are skipped; throws only if the JSON itself is not a library.
 */
export function parseLibrary(json: string): LibraryEntry[] {
  const data = JSON.parse(json) as unknown;
  const songs = Array.isArray(data) ? data : (data as Partial<LibraryFile> | null)?.kind === 'library' ? (data as LibraryFile).songs : null;
  if (!Array.isArray(songs)) throw new Error('not an Ocarina Tabs library file');
  const out: LibraryEntry[] = [];
  for (const s of songs as Partial<LibraryEntry>[]) {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) continue;
    const mode: LibraryMode = s.mode === 'abc' ? 'abc' : 'text';
    const base = makeEntry({ text: s.text, mode, source: s.source, settings: s.settings, fallbackTitle: s.title, id: typeof s.id === 'string' && s.id ? s.id : undefined });
    out.push({
      ...base,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : base.title,
      created: typeof s.created === 'number' ? s.created : base.created,
      updated: typeof s.updated === 'number' ? s.updated : base.updated,
    });
  }
  return sortLibrary(out);
}

/** Merge a backup into the library: same id → the newer copy wins; identical melodies aren't duplicated. */
export function mergeLibraries(current: LibraryEntry[], incoming: LibraryEntry[]): { list: LibraryEntry[]; added: number; updated: number } {
  let list = [...current];
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    const same = list.find((x) => x.id === e.id);
    if (same) {
      if (e.updated > same.updated) {
        list = list.map((x) => (x.id === e.id ? e : x));
        updated++;
      }
      continue;
    }
    if (findDuplicate(list, e.text, e.mode)) continue;
    list.push(e);
    added++;
  }
  return { list: sortLibrary(list), added, updated };
}
