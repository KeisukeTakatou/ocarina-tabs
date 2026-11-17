# Ocarina Tabs

Translate existing music — **MIDI, MusicXML (.musicxml/.xml/.mxl), ABC notation, or plain note text** — into
**ocarina fingering tabs** for **4-hole, 6-hole and 12-hole** ocarinas in any key and size.

It is built for two kinds of users:

- **People** use the web app: open a file or type notes, choose the ocarina, and get a printable tab sheet with playback.
  The **Music** tab shows **Tabs**, **Sheet music** (standard staff notation), or both **Side by side**. In
  side-by-side view each pane scrolls on its own. During playback, the current note is highlighted in both and
  each pane follows it (⇣ Auto-scroll). The −/+ slider resizes the diagrams and the staff (also Ctrl + mouse wheel).
  The **Library** tab keeps songs for later. Imported files are saved automatically (each melody once), typed songs
  with **Save to library**, and every song remembers its ocarina settings. It's stored in the browser, so use
  **Back up** / **Restore** (one JSON file) to keep a copy or move it to another device.
- **Claude and scripts** use the CLI, which reads files or inline text and writes text, JSON, SVG, HTML or MIDI.

Both run on the same platform-independent core (`src/core`, TypeScript, no dependencies), which a future Android app can reuse.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

The second command starts the web app on <http://localhost:5173>. To use the CLI:

```bash
npm run ocarina -- convert examples/amazing-grace.abc -i 12 -k C
```

```bash
npm test
```

## Supported ocarinas

| `-i` | Ocarina | Range (on a C instrument) | Fingering system |
|---|---|---|---|
| `4` | 4-hole pendant | C – C (13 notes) | English (John Taylor) |
| `6` | 6-hole pendant (4 + 2 thumb holes) | C – E (17 notes) | English |
| `12` | 12-hole transverse | A – F (21 notes, with sub-holes) | Japanese / Asian |

**Key** (`-k`) is any of the 12 keys: C, G, F, D, Bb, A, E, Eb, Ab, Db, B, F#.
**Size** (`--voice`) is `soprano`, `alto` (default) or `bass`. Alto tonics fall between F4 and E5
(Alto C = C5, Alto G = G4, Alto F = F4). Soprano is an octave higher and bass an octave lower. For an
unusual instrument, give the exact tonic instead: `-k G4`.

Hole names used in text and JSON output:

- 12-hole: `L1 L2 L3 L4` (left index→pinky), `R1 R2 R3 R4` (right index→pinky), `LT RT` (thumbs), `LS RS` (sub-holes)
- 4/6-hole: `L1 L2` (left upper/lower), `R1 R2` (right upper/lower, R1 is the small hole), `LT RT` (thumbs)

Fingering strings use one character per hole, in that order: `X` covered, `O` open, `H` half-covered.

The 12-hole diagram is a vector drawing traced from the common `12c_note` picture charts (a slanted body, with the thumb
holes drawn below it). Those charts finger C#6 and D#6 as L4 + R3, so the app uses those fingerings as primary;
the L1 + L4 fingerings are listed as alternates.

SVG output (Export → SVG, `-f svg`, the HTML page) has a transparent background and follows the viewer's light or dark
mode. In dark mode, covered holes are light and open holes are dark. Printing always uses the light colours. PNG
exports get a white background, since an image can't switch themes. Tools without CSS support show the light colours.

### Custom fingering charts

Makers differ slightly, especially in sharps on 4-hole pendants and in the 12-hole sub-holes. To use your own chart,
export a built-in one as a template, edit the `fingerings` (and optionally `holes` for the drawing), and pass the file
to the CLI:

```bash
npm run ocarina -- instruments --export 12 > my-ocarina.json
```

```bash
npm run ocarina -- convert song.mid --instrument-file my-ocarina.json
```

`examples/custom-instrument.json` is a worked example. Alternate fingerings (`"alt": true`) are listed but never chosen first.

## How a song is arranged

1. **Import.** The melody is extracted as one line of notes:
   - MIDI: the melody track is guessed (non-drum, highest, least chordal); pick another with `--track`. Timing is quantized to 1/12 beat.
   - MusicXML: the first part with notes, staff 1; pick with `--part` / `--staff`. Transposing instruments are converted to concert pitch, ties are merged and lyrics are kept.
   - ABC: key signatures and modes, accidentals, chords, ties, broken rhythms, tuplets, inline fields.
   - Chords are reduced to their top note. Repeats are read straight through, not expanded. The output warns you when this happens.
2. **Fit.** A transposition is chosen with `-t`:
   - `auto` (default): any shift that fits the most notes, then fewest half-holes, then keeps the key.
   - `octave`: whole octaves only, so the song stays in its key.
   - `none`: exactly as written.
   - A number, such as `-t -2`, shifts by that many semitones.
3. **Out-of-range notes** are moved by an octave and marked (`--out-of-range fold`, the default), or only marked (`mark`).
4. **Suggest.** `suggest` ranks which ocarinas (holes × key × size) play the song as written. The web app shows the same list as "Ocarinas that fit this song".

Note names can be shown as **sounding pitch** (`--names concert`) or **as read on a C chart** (`--names fingering`).
Many players of G or F ocarinas read the C-chart names.

## Note text format

The editor in the app and `--text` on the CLI use this format:

```
title: Ode to Joy
tempo: 110
time: 4/4

E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4. D4/2 D4:2 |
```

| Token | Meaning |
|---|---|
| `C4` `F#5` `Bb3` | note with octave (C4 = middle C) |
| `C D E` | letter tabs without octave: each note goes to the nearest octave |
| `:2` `:3/2` | length in beats (quarter = 1) |
| `/2` `/4` | half and quarter of a beat |
| `.` `..` | dotted, double dotted |
| `r` `r:2` | rest |
| `_` | hold the previous note one more beat |
| `\|` | bar line |
| `"la"` | lyric for the previous note |
| `# …` | comment |

## CLI reference

```
ocarina-tabs convert <file|-> [options]     Arrange a song for an ocarina and print tabs
ocarina-tabs suggest <file|-> [options]     Rank ocarinas (type/key/voice) for a song
ocarina-tabs inspect <file|-> [options]     Show tracks/parts, range and the melody as note text
ocarina-tabs chart [options]                Print a fingering chart
ocarina-tabs instruments [--json]           List supported ocarinas
ocarina-tabs instruments --export <id>      Print a full chart definition (template)
```

Common options: `-i 4|6|12`, `-k C`, `--voice alto`, `-t auto|octave|none|N`, `--out-of-range fold|mark`,
`-f text|ascii|json|svg|html|midi|notes`, `--names concert|fingering|both|none`, `--size 150` (diagram size in %),
`--notation tabs|staff|both` (SVG/HTML: tabs, sheet music, or sheet music above tabs), `-o file`,
`--text "<notes>"`, `--track N`, `--part N`, `--staff N`, `--tune N`.
Run `npm run ocarina -- help` for the full list.

To install the CLI as a command, run `npm run build` (this produces `dist-cli/ocarina-tabs.mjs`), then:

```bash
npm link
```

## Claude skill: import anything

`.claude/skills/ocarina-import` is a Claude Code skill. Give Claude any melody and ask for it in the app, and it
produces checked note text, saved to `songs/<title>.txt`. Accepted inputs:

- a sheet-music photo or PDF;
- MIDI, MusicXML or ABC;
- letter tabs, solfège, or jianpu numbers;
- guitar, bass or ukulele tabs;
- ocarina hole diagrams.

It converts each input with the rules in `reference.md` and validates the result with `inspect`.

## Sheet music images and PDFs

Scanned or PDF sheet music has to become MusicXML first. Optical music recognition, for example
[Audiveris](https://github.com/Audiveris/audiveris), MuseScore's PDF import, or a phone scanning app, can do this.
After that, open the MusicXML file here. Claude can also read a simple score from an image and write it as note text.

## Project layout

```
src/core/            platform-independent library (no DOM / Node APIs)
  pitch.ts           note names ↔ MIDI numbers
  score.ts           Score model, melody extraction
  instruments.ts     4/6/12-hole layouts + fingering charts, keys & voices
  arrange.ts         transposition search, fingering lookup, suggestions
  render/staff.ts    staff notation (clef, key, beams, ties, rests …) drawn without a music font
  library.ts         saved-song library: entries, search, backup format, merge
  parsers/           midi, musicxml (+ .mxl zip), abc, note text, format detection
  render/            SVG diagrams, tab sheet, text tabs, HTML page
src/cli/main.ts      command line interface
src/web/             web app (vanilla TS + Vite), WebAudio playback
tests/               vitest suite
examples/            sample songs in each format, custom chart example
```

## Toward an Android app

The core has no DOM or Node dependencies, and the web app is responsive and touch-friendly, with a web manifest and
relative asset paths. There are two straightforward routes to Android:

1. **Capacitor (fastest).** Run `npm run build`, add Capacitor (`npx cap add android`), and ship `dist/` in a WebView.
   File downloads need the Capacitor Filesystem/Share plugins instead of `<a download>`. `src/web/main.ts`'s `download()` is the single place to swap.
2. **Native UI (Kotlin/Compose).** Either embed the core bundle in a JS engine, or port `instruments.ts` and
   `arrange.ts`. They are small and data-driven, and the fingering charts can be exported to JSON with `instruments --export`.

The page also exposes `window.ocarinaTabs` (`loadText`, `set`, `arrangement`) so a native shell or an automation agent can drive it.
