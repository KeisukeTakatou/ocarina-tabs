import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arrange,
  cleanHoles,
  findDuplicate,
  inferKeyFifths,
  renderNotation,
  renderStaffSvg,
  spellPitch,
  splitDuration,
  makeEntry,
  mergeLibraries,
  parseLibrary,
  removeEntry,
  searchLibrary,
  serializeLibrary,
  upsertEntry,
  convert,
  getInstrument,
  importMusic,
  INSTRUMENTS,
  midiToName,
  midiToScore,
  nameToMidi,
  parseAbc,
  parseMidi,
  parseMusicXml,
  parseSimple,
  renderFingeringSvg,
  renderTabSheet,
  renderText,
  resolveTonic,
  scoreToSimple,
  suggestOcarinas,
  validateInstrument,
  writeMidi,
} from '../src/core/index.ts';

const ex = (f: string) => new URL(`../examples/${f}`, import.meta.url);

describe('pitch', () => {
  it('converts names and MIDI numbers', () => {
    expect(nameToMidi('C4')).toBe(60);
    expect(nameToMidi('A4')).toBe(69);
    expect(nameToMidi('Bb3')).toBe(58);
    expect(nameToMidi('bb3')).toBe(58);
    expect(nameToMidi('Cb5')).toBe(71);
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(61, true)).toBe('Db4');
  });
});

describe('instruments', () => {
  it('all built-in charts are valid and chromatic without gaps', () => {
    for (const inst of INSTRUMENTS) {
      expect(validateInstrument(inst)).toEqual([]);
      const offs = new Set(inst.fingerings.map((f) => f.offset));
      const min = Math.min(...offs);
      const max = Math.max(...offs);
      for (let o = min; o <= max; o++) expect(offs.has(o), `${inst.id}: offset ${o}`).toBe(true);
      // Primary fingerings are unique (no two notes share one).
      const prim = inst.fingerings.filter((f) => !f.alt).map((f) => cleanHoles(f.holes));
      expect(new Set(prim).size).toBe(prim.length);
    }
  });

  it('has the documented ranges', () => {
    const range = (id: string) => {
      const o = getInstrument(id).fingerings.map((f) => f.offset);
      return [Math.min(...o), Math.max(...o)];
    };
    expect(range('4')).toEqual([0, 12]); // C–C
    expect(range('6')).toEqual([0, 16]); // C–E
    expect(range('12')).toEqual([-3, 17]); // A–F
  });

  it('resolves tonics for keys and voices', () => {
    expect(resolveTonic('C')).toBe(72); // Alto C = C5
    expect(resolveTonic('G')).toBe(67); // Alto G = G4
    expect(resolveTonic('F')).toBe(65); // Alto F = F4
    expect(resolveTonic('E')).toBe(76); // Alto E5 (top of alto window)
    expect(resolveTonic('C', 'soprano')).toBe(84);
    expect(resolveTonic('C', 'bass')).toBe(60);
    expect(resolveTonic('G4', 'soprano')).toBe(67); // explicit octave wins
  });

  it('accepts several instrument id spellings', () => {
    expect(getInstrument('12-hole').id).toBe('12');
    expect(getInstrument(6).id).toBe('6');
    expect(getInstrument('4h').id).toBe('4');
    expect(() => getInstrument('7')).toThrow();
  });
});

describe('note text', () => {
  it('parses lengths, rests, bars, lyrics and headers', () => {
    const s = parseSimple('title: T\ntempo: 90\ntime: 3/4\nC4 D4:2 | E4/2 r/2 F4. "la" | G4 _ _');
    expect(s.title).toBe('T');
    expect(s.tempo).toBe(90);
    expect(s.timeSignature).toEqual([3, 4]);
    expect(s.notes.map((n) => [n.pitch, n.duration])).toEqual([
      [60, 1],
      [62, 2],
      [64, 0.5],
      [null, 0.5],
      [65, 1.5],
      [67, 3],
    ]);
    expect(s.notes[4].lyric).toBe('la');
    expect(s.bars).toEqual([0, 3, 5.5]); // second bar holds 2.5 beats as written
  });

  it('reads letter tabs without octaves by nearest step', () => {
    const s = parseSimple('C D E F G A B C');
    expect(s.notes.map((n) => n.pitch)).toEqual([72, 74, 76, 77, 79, 81, 83, 84]);
  });

  it('round-trips through scoreToSimple', () => {
    const src = 'tempo: 100\ntime: 4/4\nC5 D5/2 E5/2 F5:2 | G5. A5/2 r:2 |';
    const a = parseSimple(src);
    const b = parseSimple(scoreToSimple(a));
    expect(b.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual(a.notes.map((n) => [n.pitch, n.start, n.duration]));
  });

  it('reports unreadable tokens instead of failing', () => {
    const s = parseSimple('C4 xyz D4');
    expect(s.notes).toHaveLength(2);
    expect(s.warnings[0]).toMatch(/xyz/);
  });
});

describe('ABC', () => {
  it('applies key signature, accidentals per bar, octaves and lengths', () => {
    const s = parseAbc('X:1\nT:t\nM:4/4\nL:1/8\nK:G\nF2 ^c2 c2 C,2 | c2 =F2 F2 z2 |');
    // F# from key; ^c sharp; c keeps the sharp in the same bar; C, = C3
    expect(s.notes.filter((n) => n.pitch !== null).map((n) => n.pitch)).toEqual([66, 73, 73, 48, 72, 65, 65]);
    expect(s.notes[0].duration).toBe(1);
  });

  it('handles minor/modal keys, ties, broken rhythm, tuplets and chords', () => {
    const s = parseAbc('X:1\nM:4/4\nL:1/4\nK:Dm\nB A>G (3FED [CEG]2- | G |]');
    const p = s.notes.map((n) => [n.pitch, +n.duration.toFixed(3)]);
    expect(p).toEqual([
      [70, 1], // Bb from D minor
      [69, 1.5],
      [67, 0.5],
      [65, 0.667],
      [64, 0.667],
      [62, 0.667],
      [67, 3], // chord top note, tied over the bar
    ]);
    expect(s.warnings.some((w) => /chord/.test(w))).toBe(false); // chord reduced while parsing
  });

  it('reads the Amazing Grace example', () => {
    const s = parseAbc(readFileSync(ex('amazing-grace.abc'), 'utf8'));
    expect(s.title).toBe('Amazing Grace');
    expect(s.timeSignature).toEqual([3, 4]);
    expect(s.tempo).toBe(80);
    expect(s.notes[0].pitch).toBe(62); // D4 pickup
    expect(s.bars?.[1]).toBe(1); // pickup bar is one beat long
  });
});

describe('MusicXML', () => {
  it('reads notes, lyrics, tempo and title', () => {
    const s = parseMusicXml(readFileSync(ex('twinkle.musicxml'), 'utf8'));
    expect(s.title).toBe('Twinkle, Twinkle, Little Star');
    expect(s.tempo).toBe(96);
    expect(s.notes.slice(0, 4).map((n) => n.pitch)).toEqual([72, 72, 79, 79]);
    expect(s.notes[0].lyric).toBe('Twin');
    expect(s.notes[6].duration).toBe(2);
  });

  it('handles chords, ties, backup voices and transposing parts', () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Clarinet</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><transpose><chromatic>-2</chromatic></transpose></attributes>
        <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><tie type="start"/></note>
        <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
        <note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice></note>
        <backup><duration>4</duration></backup>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice></note>
      </measure><measure number="2">
        <note><pitch><step>E</step><alter>-1</alter><octave>5</octave></pitch><duration>1</duration><voice>1</voice><tie type="stop"/></note>
      </measure></part></score-partwise>`;
    const s = parseMusicXml(xml);
    // Written D5/Eb5 on a Bb clarinet sound C5/Db5; the tied Eb merges across the bar;
    // voice 2 below is dropped by the skyline.
    expect(s.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [72, 0, 2],
      [73, 2, 3],
    ]);
    expect(s.bars).toEqual([0, 4]);
  });
});

describe('MIDI', () => {
  it('writes and reads back notes', () => {
    const notes = [
      { pitch: 72, start: 0, duration: 1 },
      { pitch: null, start: 1, duration: 1 },
      { pitch: 74, start: 2, duration: 0.5 },
      { pitch: 76, start: 2.5, duration: 1.5 },
    ];
    const midi = parseMidi(writeMidi(notes, { tempo: 90, timeSignature: [3, 4] }));
    const s = midiToScore(midi);
    expect(s.tempo).toBe(90);
    expect(s.timeSignature).toEqual([3, 4]);
    expect(s.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [72, 0, 1],
      [null, 1, 1],
      [74, 2, 0.5],
      [76, 2.5, 1.5],
    ]);
  });

  it('picks the melody track over the accompaniment and reduces chords', async () => {
    const r = await importMusic(new Uint8Array(readFileSync(ex('scale-with-chords.mid'))), 'scale-with-chords.mid');
    expect(r.format).toBe('midi');
    expect(r.midiTracks).toHaveLength(2);
    expect(r.selectedTrack).toBe(0);
    const acc = await importMusic(new Uint8Array(readFileSync(ex('scale-with-chords.mid'))), 'x.mid', { track: 1 });
    expect(acc.score.notes.filter((n) => n.pitch !== null).every((n) => n.pitch === 55)).toBe(true);
    expect(acc.score.warnings.join(' ')).toMatch(/chord/);
  });
});

describe('arrange', () => {
  const ode = () => parseSimple(readFileSync(ex('ode-to-joy.txt'), 'utf8'));

  it('octave-shifts a low melody onto an alto C 12-hole without changing key', () => {
    const arr = arrange(ode(), { instrument: getInstrument('12'), tonic: resolveTonic('C') });
    expect(arr.transpose).toBe(12);
    expect(arr.stats.outOfRange).toBe(0);
    expect(arr.stats.folded).toBe(0);
    const first = arr.events[0];
    expect(first.concertName).toBe('E5');
    expect(first.holes).toBe('XXXXXXOOXXOO');
  });

  it('respects "none" and marks notes out of range', () => {
    const arr = arrange(ode(), { instrument: getInstrument('4'), tonic: resolveTonic('C') }, { transpose: 'none', outOfRange: 'mark' });
    expect(arr.transpose).toBe(0);
    expect(arr.stats.outOfRange).toBe(arr.stats.notes);
    expect(arr.events[0].holes).toBeNull();
  });

  it('folds notes beyond the range by octaves', () => {
    const s = parseSimple('C5 E5 G5 C6 E6 G6');
    const arr = arrange(s, { instrument: getInstrument('4'), tonic: 72 }, { transpose: 'none' });
    expect(arr.events.map((e) => e.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'folded', 'folded']);
    expect(arr.events[4].concertName).toBe('E5');
  });

  it('gives fingering names relative to a C chart on other keys', () => {
    const s = parseSimple('G4 A4 B4 C5');
    const arr = arrange(s, { instrument: getInstrument('6'), tonic: resolveTonic('G') }, { transpose: 'none' });
    expect(arr.events.map((e) => e.fingeringName)).toEqual(['C5', 'D5', 'E5', 'F5']);
    expect(arr.events[0].holes).toBe('XXXXXX');
  });

  it('prefers transpositions that avoid half-holes', () => {
    // C# and D# need half holes on a 4-hole in C; up a semitone they don't.
    const s = parseSimple('C#5 D#5 F#5 G#5 A#5 C#6');
    const arr = arrange(s, { instrument: getInstrument('4'), tonic: 72 }, { transpose: 'auto' });
    expect(arr.stats.halfHoles).toBe(0);
    expect(arr.stats.outOfRange + arr.stats.folded).toBe(0);
  });

  it('suggests ocarinas that play a song as written', () => {
    const s = parseSimple('A4 B4 C5 D5 E5 F6');
    const list = suggestOcarinas(s, { transpose: 'none' });
    expect(list[0]).toMatchObject({ instrument: '12', key: 'C', voice: 'alto', outOfRange: 0 });
  });
});

describe('render', () => {
  it('produces SVG and text output', async () => {
    const { arrangement, instrument } = await convert(readFileSync(ex('amazing-grace.abc'), 'utf8'), 'amazing-grace.abc', { instrument: '6', key: 'G' });
    const { svg, height } = renderTabSheet(arrangement, instrument);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(height).toBeGreaterThan(100);
    expect((svg.match(/class="cell /g) ?? []).length).toBe(arrangement.events.length);
    const text = renderText(arrangement, instrument, { symbols: 'ascii' });
    expect(text).toMatch(/Amazing Grace/);
    expect(text).toMatch(/XX XX XX/);
  });
});

describe('.mxl (compressed MusicXML)', () => {
  it('extracts the rootfile from a deflated zip', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const files: [string, string][] = [
      ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'],
      ['score.xml', readFileSync(ex('twinkle.musicxml'), 'utf8')],
    ];
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of files) {
      const data = deflateRawSync(Buffer.from(content));
      const nameBuf = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(content.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt32LE(data.length, 20);
      cd.writeUInt32LE(content.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(offset, 42);
      chunks.push(local, nameBuf, data);
      central.push(cd, nameBuf);
      offset += 30 + nameBuf.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    const zip = new Uint8Array(Buffer.concat([...chunks, cdBuf, eocd]));
    const r = await importMusic(zip, 'twinkle.mxl');
    expect(r.format).toBe('mxl');
    expect(r.score.title).toBe('Twinkle, Twinkle, Little Star');
    expect(r.score.notes).toHaveLength(14);
  });
});

describe('diagrams', () => {
  it('draws the 12-hole outline traced from the picture set, with plain thumb holes on a card', () => {
    const inst = getInstrument('12');
    expect(inst.drawing.viewBox).toEqual([198, 166]);
    const svg = renderFingeringSvg(inst, 'XXXX XXXX XX OO');
    expect(svg.match(/<circle/g)).toHaveLength(12);
    expect(svg).not.toContain('stroke-dasharray');
    expect(renderFingeringSvg(getInstrument('6'), 'XX XX XX')).toContain('stroke-dasharray');
  });

  it('scales the diagrams on the tab sheet', () => {
    const inst = getInstrument('12');
    const arr = arrange(parseSimple('C5 D5 E5 F5'), { instrument: inst, tonic: 72 }, { transpose: 'none' });
    expect(renderTabSheet(arr, inst, { scale: 2 }).height).toBeGreaterThan(renderTabSheet(arr, inst).height + 40);
  });
});

describe('transparent, theme-aware SVG', () => {
  const inst = getInstrument('12');
  const arr = arrange(parseSimple('C5 D5 r E5:9'), { instrument: inst, tonic: 72 }, { transpose: 'none' });

  it('has no background and switches to dark colours for dark-mode viewers (screen only)', () => {
    const { svg } = renderTabSheet(arr, inst);
    expect(svg).not.toContain('<rect width="100%"');
    expect(svg).toContain('@media screen and (prefers-color-scheme: dark)');
    // Every fill/stroke colour comes with a role class the dark style can override.
    for (const m of svg.matchAll(/<(?:path|circle|text|line|rect)\b[^>]*>/g)) {
      const tag = m[0];
      if (/ fill="#|stroke="#/.test(tag)) expect(tag, tag).toMatch(/class="[^"]*oc-[fs]-/);
    }
  });

  it('keeps a solid background without the dark style when one is asked for', () => {
    const { svg } = renderTabSheet(arr, inst, { background: '#ffffff' });
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    expect(svg).not.toContain('prefers-color-scheme');
    expect(renderTabSheet(arr, inst, { adaptive: false }).svg).not.toContain('<style>');
  });
});

describe('library', () => {
  const ode = 'title: Ode to Joy\ncomposer: Beethoven\nE4 E4 F4 G4 | G4 F4 E4 D4 |';

  it('makes entries with a summary, title from the melody or the file name', () => {
    const e = makeEntry({ text: ode, mode: 'text', settings: { instrument: '12', key: 'G' } }, 1000);
    expect(e).toMatchObject({ title: 'Ode to Joy', composer: 'Beethoven', notes: 8, range: 'D4–G4', created: 1000, updated: 1000 });
    expect(makeEntry({ text: 'C D E', mode: 'text', source: 'my_song-v2.mid' }).title).toBe('my song v2');
    expect(makeEntry({ text: 'X:1\nT:Abc Tune\nK:C\nCDE|', mode: 'abc' }).title).toBe('Abc Tune');
  });

  it('upserts by id keeping the creation time, finds duplicates and searches', () => {
    const a = makeEntry({ text: ode, mode: 'text', id: 'a' }, 1);
    const b = makeEntry({ text: 'title: Grace\nG4 C5', mode: 'text', id: 'b', source: 'grace.abc' }, 2);
    let list = upsertEntry(upsertEntry([], a), b);
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
    list = upsertEntry(list, { ...makeEntry({ text: ode + ' A4', mode: 'text', id: 'a' }, 5) });
    expect(list[0]).toMatchObject({ id: 'a', created: 1, updated: 5, notes: 9 });
    expect(findDuplicate(list, 'title: Grace\n  G4   C5 ', 'text')?.id).toBe('b');
    expect(findDuplicate(list, 'title: Grace\nG4 C5', 'abc')).toBeUndefined();
    expect(searchLibrary(list, 'beet joy').map((e) => e.id)).toEqual(['a']);
    expect(searchLibrary(list, 'grace.abc').map((e) => e.id)).toEqual(['b']);
    expect(removeEntry(list, 'a').map((e) => e.id)).toEqual(['b']);
  });

  it('round-trips a backup and merges it without duplicates', () => {
    const a = makeEntry({ text: ode, mode: 'text', id: 'a', settings: { instrument: '6' } }, 1);
    const json = serializeLibrary([a]);
    expect(JSON.parse(json)).toMatchObject({ app: 'ocarina-tabs', kind: 'library', version: 1 });
    const back = parseLibrary(json);
    expect(back).toEqual([a]);
    expect(() => parseLibrary('{"hello":1}')).toThrow(/not an Ocarina Tabs library/);
    expect(parseLibrary('[{"text":""},{"text":"C4 D4","title":"Two"}]').map((e) => e.title)).toEqual(['Two']);

    const newer = { ...a, text: ode + ' C4', updated: 9 };
    const copyOfA = { ...a, id: 'other' };
    const fresh = makeEntry({ text: 'G4 G4', mode: 'text', id: 'c' }, 3);
    const r = mergeLibraries([a], [copyOfA, newer, fresh]);
    expect(r).toMatchObject({ added: 1, updated: 1 });
    expect(r.list.map((e) => e.id)).toEqual(['a', 'c']);
    expect(r.list[0].updated).toBe(9);
  });
});

describe('staff notation', () => {
  const inst = getInstrument('12');
  const arrOf = (text: string) => arrange(parseSimple(text), { instrument: inst, tonic: 72 }, { transpose: 'none' });

  it('spells notes in the key and infers the key from the melody', () => {
    expect(spellPitch(78, 1)).toMatchObject({ letter: 3, acc: 1, octave: 5 }); // F#5 in G
    expect(spellPitch(70, -1)).toMatchObject({ letter: 6, acc: -1, octave: 4 }); // Bb4 in F
    expect(spellPitch(70, 0)).toMatchObject({ letter: 6, acc: -1 }); // Bb, not A#, in C
    expect(spellPitch(73, 0)).toMatchObject({ letter: 0, acc: 1 }); // C#
    expect(spellPitch(64, 0).step).toBe(30); // E4 = bottom line
    const g = parseSimple('G4 A4 B4 C5 D5 E5 F#5 G5').notes.map((n) => ({ pitch: n.pitch, duration: n.duration }));
    expect(inferKeyFifths(g)).toBe(1);
  });

  it('splits durations into notatable values, including dotted notes and triplets', () => {
    const v = (d: number) => splitDuration(d).map((p) => `${p.base}${'.'.repeat(p.dots)}${p.triplet ? '3' : ''}`);
    expect(v(1)).toEqual(['q']);
    expect(v(1.5)).toEqual(['q.']);
    expect(v(3)).toEqual(['h.']);
    expect(v(5)).toEqual(['w', 'q']);
    expect(v(1 / 3)).toEqual(['83']);
    expect(v(4 / 3)).toEqual(['q', '83']);
  });

  it('draws one cell per note piece, ties notes across bar lines and uses the source key', () => {
    // No "|" in the text, so bars fall every 4 beats and D5 (beats 3–5) crosses one.
    const arr = arrOf('time: 4/4\nC5:3 D5:2 E5:3 F#5:4');
    const { svg } = renderStaffSvg(arr);
    // D5 crosses the first bar line: two cells with the same index, joined by a tie.
    expect(svg.match(/data-index="1"/g)).toHaveLength(2);
    expect(svg.match(/<g class="cell /g)).toHaveLength(5);
    expect(svg).toContain('prefers-color-scheme: dark');

    const grace = arrange(parseAbc('X:1\nT:G tune\nM:3/4\nL:1/4\nK:G\nG A B|c2 d|'), { instrument: inst, tonic: 72 }, { transpose: 'none' });
    expect(grace.keyFifths).toBe(1);
  });

  it('stacks staff above tabs for the "both" notation', () => {
    const arr = arrOf('C5 D5 E5 F5');
    const both = renderNotation(arr, inst, 'both');
    const staff = renderNotation(arr, inst, 'staff');
    const tabs = renderNotation(arr, inst, 'tabs');
    expect(both.height).toBeGreaterThan(staff.height);
    expect(both.svg.match(/<svg /g)).toHaveLength(3);
    expect(both.svg.match(/Untitled/g)).toHaveLength(1); // one title for the whole page
    expect(tabs.svg).not.toContain('<ellipse');
    expect(staff.svg).toContain('<ellipse');
  });
});
