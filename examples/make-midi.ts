// Generates examples/scale-with-chords.mid: a melody track plus a chord accompaniment track,
// to exercise MIDI track selection and chord reduction. Run: npx tsx examples/make-midi.ts
import { writeFileSync } from 'node:fs';
import { writeMidi } from '../src/core/index.ts';

const melody = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81].map((p, i) => ({ pitch: p, start: i * 0.5, duration: 0.5 }));
const mel = writeMidi(melody, { tempo: 100 });
const chords = [0, 2, 4].flatMap((bar) => [48, 52, 55].map((p) => ({ pitch: p, start: bar * 2, duration: 2 })));
const acc = writeMidi(chords, { tempo: 100, program: 0 });

// Merge the two single-track files into one format-1 file.
const trackOf = (f: Uint8Array) => f.subarray(14);
const header = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0]);
const out = new Uint8Array(header.length + trackOf(mel).length + trackOf(acc).length);
out.set(header, 0);
out.set(trackOf(mel), header.length);
out.set(trackOf(acc), header.length + trackOf(mel).length);
writeFileSync(new URL('./scale-with-chords.mid', import.meta.url), out);
console.log('wrote examples/scale-with-chords.mid');
