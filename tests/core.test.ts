import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arrange,
  cleanHoles,
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
