#!/usr/bin/env node
// ocarina-tabs CLI — translate MIDI / MusicXML / ABC / note text into ocarina fingerings.
// Designed to be driven by people and by AI agents: every command can emit JSON.

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  arrange,
  describeOcarina,
  getInstrument,
  importMusic,
  ImportOptions,
  InputFormat,
  InstrumentDef,
  listInstruments,
  midiToName,
  offsetRange,
  pitchRange,
  registerInstrument,
  renderChartSvg,
  renderChartText,
  renderHtml,
  Notation,
  renderNotation,
  renderText,
  resolveTonic,
  scoreToSimple,
  suggestOcarinas,
  TransposeMode,
  Voice,
  writeMidi,
  NameMode,
} from '../core/index.ts';

const HELP = `ocarina-tabs — translate sheet music into ocarina fingering tabs

USAGE
  ocarina-tabs convert <file|-> [options]     Arrange a song for an ocarina and print tabs
  ocarina-tabs suggest <file|-> [options]     Rank ocarinas (type/key/voice) for a song
  ocarina-tabs inspect <file|-> [options]     Show tracks/parts, range and the melody as note text
  ocarina-tabs chart [options]                Print a fingering chart
  ocarina-tabs instruments [--json]           List supported ocarinas
  ocarina-tabs instruments --export <id>      Print a full chart definition (template for custom charts)

INPUT  (.mid .midi .musicxml .xml .mxl .abc .txt, or "-" for stdin)
  --text "<notes>"         Inline note text instead of a file, e.g. --text "C5 D5 E5:2 | G5/2 r/2"
  --from <fmt>             Force format: midi | musicxml | mxl | abc | text
  --track <n|auto|all>     MIDI track to use as melody (see "inspect")
  --channel <0-15>         MIDI channel filter
  --part <n|id>            MusicXML part (0-based index or id)
  --staff <n>              MusicXML staff (piano: 1 = right hand)
  --tune <n>               ABC tune number in multi-tune files (0-based)

OCARINA
  -i, --instrument <4|6|12>   Hole count (default 12). Custom: --instrument-file chart.json
  -k, --key <key>             Ocarina key: C G F D Bb … (default C). With octave = exact tonic, e.g. G4
  --voice <alto|soprano|bass> Size/register (default alto). Alto C tonic = C5, Alto G = G4, Alto F = F4
  -t, --transpose <mode>      auto (default) | octave | none | <semitones>
  --out-of-range <fold|mark>  Move unplayable notes by octaves (default) or just flag them

OUTPUT
  -f, --format <fmt>       text (default) | ascii | json | svg | html | midi | notes
  --names <mode>           concert (default) | fingering | both | none
  --width <px>             SVG/HTML sheet width (default 860)
  --size <percent>         SVG/HTML diagram size, e.g. 150 or 150% (default 100, range 40–400)
  --notation <view>        SVG/HTML: tabs (default) | staff (sheet music) | both (staff above tabs)
  -o, --out <file>         Write to file (format inferred from extension if --format omitted)
  --json                   Shortcut for --format json

EXAMPLES
  ocarina-tabs convert song.mid -i 12 -k C
  ocarina-tabs convert tune.abc -i 6 -k G --format svg -o tune.svg
  ocarina-tabs convert --text "E4 E4 F4 G4 | G4 F4 E4 D4" -i 4 --json
  ocarina-tabs suggest song.musicxml --transpose none
  ocarina-tabs chart -i 12 -k G --voice soprano
`;

type Opts = Record<string, string | boolean>;

const ALIASES: Record<string, string> = { i: 'instrument', k: 'key', t: 'transpose', f: 'format', o: 'out', h: 'help' };
const FLAGS = new Set(['json', 'help', 'ascii']);

function parseArgs(argv: string[]): { cmd: string; positional: string[]; opts: Opts } {
  const positional: string[] = [];
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && a !== '-')) {
      let key = a.replace(/^--?/, '');
      let val: string | undefined;
      const eq = key.indexOf('=');
      if (eq >= 0) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      key = ALIASES[key] ?? key;
      if (FLAGS.has(key)) opts[key] = true;
      else {
        val ??= argv[++i];
        if (val === undefined) fail(`Missing value for --${key}`);
        opts[key] = val as string;
      }
    } else positional.push(a);
  }
  return { cmd: positional.shift() ?? 'help', positional, opts };
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function notationOpt(opts: Opts): Notation {
  const v = str(opts, 'notation') ?? 'tabs';
  if (v === 'sheet') return 'staff';
  if (v !== 'tabs' && v !== 'staff' && v !== 'both') fail('--notation must be tabs, staff or both');
  return v;
}

/** --size → sheet options. */
function diagramOpts(opts: Opts): { scale: number } {
  const raw = str(opts, 'size');
  if (raw === undefined) return { scale: 1 };
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) fail('--size must be a number such as 150 or 150%');
  return { scale: raw.trim().endsWith('%') || n > 4 ? n / 100 : n };
}

function str(o: Opts, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}

function readStdin(): Uint8Array {
  return new Uint8Array(readFileSync(0));
}

async function loadInput(positional: string[], opts: Opts) {
  const io: ImportOptions = {};
  const from = str(opts, 'from');
  if (from) io.format = from as InputFormat;
  const track = str(opts, 'track');
  if (track) io.track = track === 'auto' || track === 'all' ? track : parseInt(track, 10);
  if (str(opts, 'channel')) io.channel = parseInt(str(opts, 'channel')!, 10);
  const part = str(opts, 'part');
  if (part !== undefined) io.part = /^\d+$/.test(part) ? parseInt(part, 10) : part;
  if (str(opts, 'staff')) io.staff = parseInt(str(opts, 'staff')!, 10);
  if (str(opts, 'tune')) io.tune = parseInt(str(opts, 'tune')!, 10);

  const inline = str(opts, 'text');
  if (inline !== undefined) return importMusic(inline.replace(/\\n/g, '\n'), undefined, { ...io, format: io.format ?? 'text' });
  const file = positional[0];
  if (!file) fail('No input. Give a file path, "-" for stdin, or --text "<notes>".');
  let data: Uint8Array;
  try {
    data = file === '-' ? readStdin() : new Uint8Array(readFileSync(file));
  } catch (e) {
    fail(`Cannot read ${file}: ${(e as Error).message}`);
  }
  return importMusic(data, file === '-' ? undefined : file, io);
}

function loadOcarina(opts: Opts): { inst: InstrumentDef; tonic: number } {
  const file = str(opts, 'instrument-file');
  let inst: InstrumentDef;
  if (file) {
    try {
      inst = registerInstrument(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      fail(`Cannot load instrument file: ${(e as Error).message}`);
    }
  } else {
    try {
      inst = getInstrument(str(opts, 'instrument') ?? '12');
    } catch (e) {
      fail((e as Error).message);
    }
  }
  const voice = (str(opts, 'voice') ?? 'alto') as Voice;
  if (!['alto', 'soprano', 'bass'].includes(voice)) fail(`Unknown voice "${voice}" (alto, soprano, bass)`);
  let tonic: number;
  try {
    tonic = resolveTonic(str(opts, 'key') ?? 'C', voice);
  } catch (e) {
    fail((e as Error).message);
  }
  return { inst, tonic };
}

function transposeOpt(opts: Opts, def: TransposeMode = 'auto'): TransposeMode {
  const t = str(opts, 'transpose');
  if (t === undefined) return def;
  if (t === 'auto' || t === 'octave' || t === 'none') return t;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) fail(`Bad --transpose "${t}" (auto, octave, none or a number)`);
  return n;
}

function outputFormat(opts: Opts, fallback = 'text'): string {
  if (opts.json) return 'json';
  const f = str(opts, 'format');
  if (f) return f;
  const out = str(opts, 'out');
  if (out) {
    const ext = extname(out).toLowerCase().slice(1);
    const map: Record<string, string> = { svg: 'svg', html: 'html', htm: 'html', json: 'json', mid: 'midi', midi: 'midi', txt: 'text' };
    if (map[ext]) return map[ext];
  }
  return fallback;
}

function emit(opts: Opts, content: string | Uint8Array) {
  const out = str(opts, 'out');
  if (out) {
    writeFileSync(out, content);
    process.stderr.write(`wrote ${out}\n`);
  } else if (typeof content === 'string') process.stdout.write(content);
  else process.stdout.write(content);
}

async function main() {
  const { cmd, positional, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }

  switch (cmd) {
    case 'instruments': {
      const exp = str(opts, 'export');
      if (exp) {
        // Full definition — a template for a maker-specific chart (edit, then use --instrument-file).
        emit(opts, JSON.stringify(getInstrument(exp), null, 2) + '\n');
        return;
      }
      const list = listInstruments().map((i) => {
        const [lo, hi] = offsetRange(i);
        return {
          id: i.id,
          name: i.name,
          description: i.description,
          holes: i.holes.map((h) => ({ id: h.id, label: h.label })),
          rangeOnAltoC: `${midiToName(72 + lo)}–${midiToName(72 + hi)}`,
          notes: hi - lo + 1,
        };
      });
      if (opts.json) emit(opts, JSON.stringify(list, null, 2) + '\n');
      else emit(opts, list.map((i) => `${i.id.padEnd(3)} ${i.name.padEnd(22)} ${i.rangeOnAltoC.padEnd(8)} ${i.notes} notes\n    ${i.description}\n    holes: ${i.holes.map((h) => h.id).join(' ')}`).join('\n') + '\n');
      return;
    }

    case 'chart': {
      const { inst, tonic } = loadOcarina(opts);
      const fmt = outputFormat(opts);
      if (fmt === 'json') {
        emit(opts, JSON.stringify({ instrument: inst.id, tonic: midiToName(tonic), holes: inst.holes.map((h) => h.id), fingerings: inst.fingerings.map((f) => ({ note: midiToName(tonic + f.offset), reads: midiToName(72 + f.offset), offset: f.offset, holes: f.holes.replace(/\s/g, ''), alt: !!f.alt })) }, null, 2) + '\n');
      } else if (fmt === 'svg') emit(opts, renderChartSvg(inst, tonic, { width: Number(str(opts, 'width') ?? 860), fingeringNames: true, ...diagramOpts(opts) }).svg);
      else emit(opts, renderChartText(inst, tonic, { symbols: fmt === 'ascii' ? 'ascii' : 'unicode' }));
      return;
    }

    case 'inspect': {
      const input = await loadInput(positional, opts);
      const range = pitchRange(input.score);
      const info = {
        format: input.format,
        title: input.score.title,
        tempo: input.score.tempo,
        timeSignature: input.score.timeSignature,
        notes: input.score.notes.filter((n) => n.pitch !== null).length,
        range: range ? `${midiToName(range[0])}–${midiToName(range[1])} (${range[1] - range[0]} semitones)` : null,
        midiTracks: input.midiTracks,
        selectedTrack: input.selectedTrack,
        musicXmlParts: input.musicXmlParts,
        abcTunes: input.abcTunes,
        warnings: input.score.warnings,
      };
      if (outputFormat(opts) === 'json') emit(opts, JSON.stringify({ ...info, noteText: scoreToSimple(input.score) }, null, 2) + '\n');
      else {
        const lines = [
          `format: ${info.format}`,
          `title: ${info.title ?? '-'}`,
          `notes: ${info.notes}, range: ${info.range ?? '-'}`,
          `tempo: ${info.tempo}, time: ${info.timeSignature.join('/')}`,
        ];
        if (info.midiTracks) {
          lines.push('MIDI tracks (use --track N):');
          for (const t of info.midiTracks)
            lines.push(`  ${t.index === info.selectedTrack ? '*' : ' '} ${String(t.index).padStart(2)}  ${t.name.padEnd(24)} ${String(t.notes).padStart(5)} notes  ${t.lowest !== null ? midiToName(t.lowest) : ''}–${t.highest !== null ? midiToName(t.highest) : ''}${t.drums ? '  (drums)' : ''}`);
        }
        if (info.musicXmlParts) {
          lines.push('MusicXML parts (use --part N):');
          for (const p of info.musicXmlParts) lines.push(`    ${String(p.index).padStart(2)}  ${p.name.padEnd(24)} ${p.notes} notes  (id ${p.id})`);
        }
        if (info.abcTunes) lines.push('ABC tunes (use --tune N):', ...info.abcTunes.map((t) => `    ${t.index}  ${t.title}`));
        for (const w of info.warnings) lines.push(`! ${w}`);
        lines.push('', '--- melody as note text ---', scoreToSimple(input.score));
        emit(opts, lines.join('\n'));
      }
      return;
    }

    case 'suggest': {
      const input = await loadInput(positional, opts);
      const insts = str(opts, 'instrument') ? [getInstrument(str(opts, 'instrument')!)] : undefined;
      const list = suggestOcarinas(input.score, { transpose: transposeOpt(opts, 'octave'), instruments: insts, limit: Number(str(opts, 'limit') ?? 10) });
      if (outputFormat(opts) === 'json') emit(opts, JSON.stringify(list, null, 2) + '\n');
      else {
        const range = pitchRange(input.score);
        const lines = [`Song range: ${range ? `${midiToName(range[0])}–${midiToName(range[1])}` : '-'}`, '', 'rank  ocarina                    key  voice    tonic  transpose  unplayable  half-holes'];
        list.forEach((s, i) =>
          lines.push(
            `${String(i + 1).padStart(4)}  ${s.instrumentName.padEnd(25)}  ${s.key.padEnd(3)}  ${s.voice.padEnd(7)}  ${s.tonic.padEnd(5)}  ${String(s.transpose).padStart(9)}  ${String(s.outOfRange).padStart(10)}  ${String(s.halfHoles).padStart(10)}`,
          ),
        );
        emit(opts, lines.join('\n') + '\n');
      }
      return;
    }

    case 'convert': {
      const input = await loadInput(positional, opts);
      const { inst, tonic } = loadOcarina(opts);
      const oor = str(opts, 'out-of-range') ?? 'fold';
      if (oor !== 'fold' && oor !== 'mark') fail('--out-of-range must be fold or mark');
      const arr = arrange(input.score, { instrument: inst, tonic }, { transpose: transposeOpt(opts), outOfRange: oor });
      const names = (str(opts, 'names') ?? 'concert') as NameMode;
      const fmt = outputFormat(opts);
      switch (fmt) {
        case 'json':
          emit(opts, JSON.stringify({ ocarina: describeOcarina({ instrument: inst, tonic }), input: { format: input.format, midiTracks: input.midiTracks, selectedTrack: input.selectedTrack, musicXmlParts: input.musicXmlParts }, holeOrder: inst.holes.map((h) => h.id), arrangement: arr }, null, 2) + '\n');
          break;
        case 'svg':
          emit(opts, renderNotation(arr, inst, notationOpt(opts), { width: Number(str(opts, 'width') ?? 860), names, ...diagramOpts(opts) }).svg);
          break;
        case 'html':
          emit(opts, renderHtml(arr, inst, { names, notation: notationOpt(opts), ...diagramOpts(opts) }));
          break;
        case 'midi':
          if (!str(opts, 'out')) fail('MIDI output is binary; use --out file.mid');
          emit(opts, writeMidi(arr.events.map((e) => ({ pitch: e.status === 'out-of-range' ? null : e.pitch, start: e.start, duration: e.duration })), { tempo: arr.tempo, timeSignature: arr.timeSignature }));
          break;
        case 'notes': {
          // Arranged (transposed/folded) melody back as editable note text.
          const score = { ...input.score, notes: arr.events.map((e) => ({ pitch: e.status === 'out-of-range' ? null : e.pitch, start: e.start, duration: e.duration, lyric: e.lyric })) };
          emit(opts, scoreToSimple(score));
          break;
        }
        case 'text':
        case 'ascii':
          emit(opts, renderText(arr, inst, { names, symbols: fmt === 'ascii' ? 'ascii' : 'unicode' }));
          break;
        default:
          fail(`Unknown format "${fmt}"`);
      }
      return;
    }

    default:
      fail(`Unknown command "${cmd}". Run "ocarina-tabs help".`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
