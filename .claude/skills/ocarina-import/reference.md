# Converting text tabs to note text

Every system below ends the same way: the result is absolute pitches with octaves (C4 = middle C) and durations in
beats, where a quarter note = 1. When the source has no rhythm, use 1 beat per note and say so.

## Letter-note tabs ("E E F G | G F E D")

- **Tabs written for an ocarina** usually name notes as read on a C chart. Plain letters are the octave starting on the
  tonic, so for an Alto C, `C D E … B` = C5–B5. High notes are marked `C'`, `C^`, `high C`, `^C`, or are lowercase
  (`c`) = C6–F6. Notes below the tonic, written `low A` or `low B`, are A4 and B4. If the tab names an ocarina in
  another key (G or F), it is still read on a C chart: convert it as if for C. The app transposes the result, and
  the user can pick the G ocarina.
- **Tabs for piano or general use** with no octave marks: put the first note in octave 4 or 5, wherever the tune fits
  best (see the octave check below), then follow the melody's contour. If octave marks such as `C5` are given, keep them.
- Sharps and flats: `C#`, `Db`, `C♯`, `D♭`. `C+` sometimes means C#, but check how the source uses it.
- `-` or `—` after a note usually means "hold". Write `_`, one per extra beat.

## Solfège (do re mi)

- **Fixed do** (common in French, Italian, Spanish and Turkish sources): do = C, re = D, mi = E, fa = F, sol = G,
  la = A, si/ti = B. Sharps and flats are written as words ("fa diesis", "si bemolle", "fa diyez") or as ♯/♭ signs.
- **Movable do** (English-language sources with a stated key): do = the tonic of that key. Chromatic syllables:
  di ri fi si li (raised) and ra me se le te (lowered).
- If no key is stated and the source isn't from a fixed-do tradition, assume do = C and say so.
- Octave marks: apostrophe or a superscript dot means up, a comma or a subscript dot means down. Otherwise follow the
  contour.

## Numbered notation (jianpu, "1 2 3 | 5 - 5 -")

- `1=G` (or `1=Bb`) is the pitch of degree 1. If it is missing, use 1 = C.
- 1 2 3 4 5 6 7 are degrees of the major scale on that note. `0` is a rest. `#4` and `b7` are chromatic.
- Octave: a dot above (in text: `1'`, `1·` above, or `i`) means up one octave. A dot below (`1,` or `.1`) means down one.
  With no dots, the note is in the octave whose 1 is the `1=` note in octave 4 (1=G → G4). Those notes may lie
  higher than written, which is fine because the app transposes.
- Rhythm, with a plain digit = 1 beat:
  - each `-` after a note adds 1 beat;
  - one underline (or `_` in text, or a digit inside `( )`) = `/2`, and a double underline = `/4`;
  - a `.` after the digit = dotted.
- Bar lines are `|`.

## Guitar, bass and ukulele tabs

Each line is a string, and each number is a fret. Pitch = the open-string pitch + the fret number.

| Instrument | Strings (top line → bottom line) | Open pitches |
|---|---|---|
| Guitar, standard | e B G D A E | E4 B3 G3 D3 A2 E2 |
| Bass, 4-string | G D A E | G2 D2 A1 E1 |
| Ukulele, standard (re-entrant) | A E C G | A4 E4 C4 G4 |

- Use the tuning written at the left of the tab if one is given (Drop D: the lowest string is D2). A capo on fret N
  adds N to every fret.
- Read columns left to right. Several numbers in one column form a chord: keep the **highest pitch** unless the tab
  marks a melody string.
- Ornaments:
  - `7h9` and `9p7` (hammer-on / pull-off): two notes, 7 then 9.
  - `7b9` (bend): one note at the target pitch (fret 9).
  - `7/9` and `9\7` (slides): two notes.
  - `~` (vibrato) and `x` (muted): ignore. Treat `PM` (palm mute) as a normal note.
- Spacing between columns only hints at rhythm. Use quarter notes unless the tab has rhythm marks above it.
- Guitar and bass tabs often sit low for an ocarina, which is fine: keep the real pitches, and the app's best-fit
  transposition will move the tune into range.

## Ocarina hole tabs (●○ diagrams or X/O strings)

1. Count the holes to pick the chart: 4, 6 (4 + 2 thumbs) or 12.
2. Get the chart in the tab's key. If none is stated, use C:
   ```bash
   npm run ocarina -- chart -i 12 -k C --json
   ```
   Each entry has `note` (the sounding pitch on that ocarina), `reads` (the C-chart name), `holes` (no spaces, in
   the order of `holes`) and `alt`.
3. Rewrite each diagram as an X/O/H string in that order and find its exact match. Hole order:
   - **12-hole:** L1 L2 L3 L4 (left index → pinky), R1 R2 R3 R4, LT RT (thumbs), LS RS (sub-holes).
     - In the app's 12-hole drawing (traced from the common picture charts), the left hand runs from the lower-left
       hole (L1) up the diagonal to L4. The right hand runs from R1 (lower middle) up to R4 (top right).
     - The thumb holes are the two circles below the outline: LT on the left, RT on the right.
     - The small holes are LS (lower-left, between L1 and the bottom) and RS (top, between L4 and R2).
   - **4-hole:** L1 (upper-left), L2 (lower-left), R1 (upper-right, the small one), R2 (lower-right).
   - **6-hole:** the four front holes as above, then LT RT (back thumbs).
4. If a diagram doesn't match any entry, the source chart probably uses another maker's fingering. Choose the nearest
   chart entry (the one that differs in the fewest holes) and name it in the uncertainty list.
5. Write the `note` value for each one. If the tab gives no octave or key, keep C-chart pitches (`reads`): the app
   transposes the result anyway.

## The app's own exports

- The **Notes** export (`.txt`) is already note text.
- The **Text tabs** export lists note names under each fingering. Read them in order.
- The **JSON** export has `arrangement.events[]`. Use `pitch` (MIDI number; `null` = rest) and `duration`, and convert
  each pitch with `midiToName`. You can also re-import its MIDI export with `inspect`.

## Sanity checks

- Range: a melody normally spans an octave and a half at most. A jump of more than an octave between neighbouring
  notes usually means you got an octave wrong.
- Bar totals: every full bar should add up to the time signature, except for a pickup bar at the start.
- Key: if many notes come out as accidentals, you probably missed a key signature, or the movable-do key is wrong.
