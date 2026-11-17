# Ocarina Tabs — notes for Claude

The tool translates existing music into ocarina fingerings. When a user asks for tabs, use the CLI rather than
working fingerings out by hand: the charts live in `src/core/instruments.ts`.

When a user wants a melody *in the app* (as note text), follow the `ocarina-import` skill in `.claude/skills/`.

## Typical workflow

1. **Get the melody.**
   - For a file (MIDI, MusicXML, .mxl, ABC), run `npm run ocarina -- inspect <file>` to see tracks/parts, the range and the melody as note text. Pick a track with `--track N` or a part with `--part N` if the guess is wrong.
   - When the user describes or pastes a tune, write it as note text (see README) and pass it with `--text "..."` (use `\n` for new lines), or save it to a `.txt` file. ABC also works (`--from abc`).
   - For a sheet music image, read the notes and transcribe them into note text. Say that it was transcribed by hand and may contain errors.
2. **Pick the ocarina.** If the user hasn't said which one, run `suggest` and recommend the top fit, or ask:
   `npm run ocarina -- suggest <file> --transpose none`
3. **Convert.**
   - `npm run ocarina -- convert <file> -i 12 -k C` gives readable text tabs (● covered, ○ open, ◐ half).
   - Add `--json` for structured data (`arrangement.events[].holes`, `status`, `concertName`, `fingeringName`).
   - Use `-f svg -o out.svg` or `-f html -o out.html` for a printable sheet. Add `--size 150` for bigger diagrams,
     and `--notation staff` (sheet music) or `--notation both` (sheet music above tabs).
4. **Report problems.** Check `stats.folded` and `stats.outOfRange` and the `warnings`. Mention notes moved by an octave and any transposition, and suggest a better ocarina or key when many notes don't fit.

## Conventions

- Pitches are MIDI numbers and names use C4 = middle C. Alto C tonic = C5. The 12-hole range on an Alto C is A4–F6.
- The `holes` string has one char per hole in `holeOrder`: `X` covered, `O` open, `H` half.
- `fingeringName` is the note name on a C chart. It is the same as the concert name only for C ocarinas.

## Development

- `npm test` runs vitest, `npm run typecheck` runs tsc, and `npm run dev` starts the web app (launch config "web" on port 5174).
- Keep `src/core` free of DOM and Node APIs, because the web app and a future Android app share it.
- When changing a fingering chart, keep each chart chromatic with no gaps and keep primary fingerings unique. The test suite checks both.
