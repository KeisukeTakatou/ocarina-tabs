---
name: ocarina-import
description: Turn any sheet music or tab into Ocarina Tabs note text that can be pasted into the app's Notes box or opened as a .txt file. Use it when the user gives a melody in any form and wants it in the app. Accepted inputs include a staff-notation image or PDF, MIDI, MusicXML/.mxl, ABC, letter-note tabs ("E E F G"), ocarina hole tabs (●○ diagrams or X/O strings), solfège ("do re mi"), numbered notation (jianpu, "1 2 3"), guitar, bass or ukulele tabs, piano letter notes, or a tune pasted or described in chat.
---

# Sheet music or tabs → Ocarina Tabs note text

The goal is one block of **note text** that the app (Notes box or Open file) and the CLI (`--text`, or a `.txt` file) will
accept, and that matches the source melody note for note. Do not arrange the melody for an ocarina here: the app picks
the ocarina, key and transposition itself. Keep the source's real pitches and rhythm.

## 1. Work out what you were given

| Input | How to read it |
|---|---|
| `.mid` `.midi` `.musicxml` `.xml` `.mxl` `.abc` file | Use the CLI, not your own reading: step 2a |
| Image or PDF of staff notation | Read it yourself: step 2b |
| Text tabs (letters, solfège, numbers, guitar tabs, ocarina hole tabs) | Convert them using [reference.md](reference.md): step 2c |
| A tune described in words ("the start of Für Elise") | Write it from memory only if you are sure of it, and say that is what you did |

If you can't tell which system a text tab uses (for example, whether numbers mean jianpu or frets), look for clues: a
`1=G` header means jianpu; six lines labelled `e B G D A E` mean guitar tab. If it is still unclear, ask.

## 2a. Files the app can already read

```bash
npm run ocarina -- inspect <file> --json
```

`noteText` in the output is the answer. Before using it, check:

- **Melody choice.** `midiTracks` / `musicXmlParts` / `abcTunes` list the alternatives. If the guessed melody looks
  wrong (for example, a bass line, a drum track, or very few notes), re-run with `--track N`, `--part N`, `--staff N`
  or `--tune N`.
- **Warnings.** Chords reduced to their top note and repeats not expanded are both reported. If the piece has repeats
  the player is meant to take, write the repeated bars out yourself (step 3).

Binary files can also be opened directly in the app, so mention that as an option. The note text is still useful when
the user wants to edit the melody.

## 2b. Staff notation from an image or PDF

Work bar by bar, writing one bar per `|`:

1. **Clef, key signature and time signature first.** Every note the key signature affects must be written with its
   accidental, because note text has no key signature: in G major every F is `F#`. Accidentals written in a bar last
   until the bar line, and ties carry them over.
2. **Octave.** In treble clef the bottom line is E4 and the middle line is B4. In bass clef the bottom line is G2.
   A treble clef with an 8 below it sounds an octave lower.
3. **Rhythm.** With a quarter note as 1 beat, durations are: whole `:4`, half `:2`, quarter (none), eighth `/2`,
   sixteenth `/4`, dotted quarter `.` (or `:3/2`), and triplet eighths `:1/3` each. In 6/8, keep quarter = 1 beat, so
   each eighth is still `/2`. Check that each bar adds up to the time signature.
4. **Melody only.** If a chord or a second voice appears, take the top note (or the voice carrying the tune). Keep
   lyrics as `"syllable"` after the note if they are printed under it.
5. **Repeats, voltas, D.C./D.S.** Write them out in playing order.
6. For a PDF over 10 pages, read the pages with the melody (`pages` parameter). For a scan you can't read, suggest
   OMR (Audiveris, or MuseScore's PDF import) to MusicXML, then step 2a.

Always tell the user that the result was **transcribed by hand from an image and may contain mistakes**. Name any bars
you were unsure of.

## 2c. Text tabs

Follow the conversion rules for that system in [reference.md](reference.md). It covers letter tabs, solfège, jianpu,
guitar/bass/ukulele tabs, ocarina hole tabs, and piano letter notes. The short version:

- Turn every symbol into an absolute pitch with an octave (`C5`, `F#4`). Use letters without octaves only if the
  source truly has no octave information. The app then picks the nearest octave, which can jump.
- Most tabs have no rhythm. If the source gives none, use quarter notes, add `|` where the source breaks lines or
  phrases, and tell the user that the rhythm is a guess.
- For ocarina hole tabs, look each pattern up in the chart and never guess:
  `npm run ocarina -- chart -i <4|6|12> -k <key of the tab> --json`. Match `holes` after removing spaces, using
  the hole order in the chart's `holes` field. If no key is given, assume C.

## 3. Write the note text

```
title: Ode to Joy
composer: Beethoven
tempo: 110
time: 4/4
key: C

E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4. D4/2 D4:2 |
```

| Token | Meaning |
|---|---|
| `C4` `F#5` `Bb3` | Note with octave (C4 = middle C). Use `#` or `b`; `x` is a double sharp |
| `:2` `:3/2` `/2` `/4` | Length in beats (quarter = 1). No suffix = 1 beat |
| `.` `..` | Dotted, double dotted |
| `r` `r:2` `r/2` | Rest |
| `_` | Hold the previous note one more beat (repeat `_ _` for more) |
| `\|` | Bar line |
| `"la"` | Lyric for the previous note |
| `# …` | Comment until end of line (fine for "bar 12 unclear") |

Headers are optional. `key:` only chooses between sharp and flat spellings; it does **not** apply a key signature.
Keep 4 bars per line for readability.

## 4. Check it with the parser before handing it over

Save the text and inspect it:

```bash
npm run ocarina -- inspect song.txt
```

- Unreadable tokens are skipped, not fatal. The warnings line says `Skipped N unreadable token(s)`, and that must not appear. Fix every token it lists.
- Check that the **note count** and **range** match the source. A range far wider than the tune means an octave slip.
- Optionally, run `npm run ocarina -- suggest song.txt --transpose none` to say which ocarina plays it as written.

## 5. Hand it over

1. Save it as `songs/<kebab-title>.txt` in the project (create the folder if needed), unless the user wants it
   somewhere else.
2. Show the note text in one fenced code block so it can be copied.
3. Give import instructions in one line. Either paste it into **Notes** (mode "Note text"), or use **Open file** and
   pick the `.txt`.
4. List anything uncertain:
   - a hand transcription;
   - a guessed rhythm;
   - an assumed key or octave;
   - repeats written out;
   - chords reduced to the melody.
