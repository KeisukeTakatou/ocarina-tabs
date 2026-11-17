// Public API of the platform-independent core (no DOM, no Node APIs).
// Used by the CLI, the web app, and a future Android app (WebView/Capacitor or a JS engine).

export * from './pitch.ts';
export * from './score.ts';
export * from './instruments.ts';
export * from './arrange.ts';
export * from './parsers/import.ts';
export { parseAbc, listAbcTunes, abcKeyFifths } from './parsers/abc.ts';
export { parseMidi, midiToScore, writeMidi, describeMidiTracks, guessMelodyTrack } from './parsers/midi.ts';
export type { MidiFile, MidiTrackInfo } from './parsers/midi.ts';
export { parseMusicXml, listMusicXmlParts } from './parsers/musicxml.ts';
export { parseSimple, scoreToSimple, formatDuration } from './parsers/simple.ts';
export { extractMxl } from './parsers/zip.ts';
export * from './render/diagram.ts';
export * from './render/sheet.ts';
export * from './render/text.ts';
export * from './render/html.ts';

import { arrange, Arrangement, ArrangeOptions } from './arrange.ts';
import { getInstrument, InstrumentDef, resolveTonic, Voice } from './instruments.ts';
import { importMusic, ImportOptions, ImportResult } from './parsers/import.ts';

export interface ConvertOptions extends ImportOptions, ArrangeOptions {
  instrument?: string | number;
  /** "C", "G", "Bb" … or with octave "G4". */
  key?: string;
  voice?: Voice;
}

export interface ConvertResult {
  input: ImportResult;
  instrument: InstrumentDef;
  arrangement: Arrangement;
}

/** One-call pipeline: file bytes/text → arrangement on the chosen ocarina. */
export async function convert(data: Uint8Array | string, name: string | undefined, opts: ConvertOptions = {}): Promise<ConvertResult> {
  const input = await importMusic(data, name, opts);
  const instrument = getInstrument(opts.instrument ?? '12');
  const tonic = resolveTonic(opts.key ?? 'C', opts.voice ?? 'alto');
  const arrangement = arrange(input.score, { instrument, tonic }, opts);
  return { input, instrument, arrangement };
}
