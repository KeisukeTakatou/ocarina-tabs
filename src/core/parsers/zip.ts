// Minimal ZIP reader for compressed MusicXML (.mxl). Uses the platform DecompressionStream
// (Node 18+, all modern browsers and Android WebView) — no dependencies.

export function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

interface Entry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

function u16(d: Uint8Array, o: number) {
  return d[o] | (d[o + 1] << 8);
}
function u32(d: Uint8Array, o: number) {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

function listEntries(d: Uint8Array): Entry[] {
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65558); i--) {
    if (u32(d, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP/.mxl file (no central directory)');
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(d, p) !== 0x02014b50) break;
    const method = u16(d, p + 10);
    const compSize = u32(d, p + 20);
    const nameLen = u16(d, p + 28);
    const extraLen = u16(d, p + 30);
    const commentLen = u16(d, p + 32);
    const localOffset = u32(d, p + 42);
    out.push({ name: dec.decode(d.subarray(p + 46, p + 46 + nameLen)), method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(d: Uint8Array, e: Entry): Promise<Uint8Array> {
  const o = e.localOffset;
  const start = o + 30 + u16(d, o + 26) + u16(d, o + 28);
  const raw = d.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`Unsupported ZIP compression method ${e.method}`);
  const stream = new Blob([raw.slice() as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extract the main MusicXML document from an .mxl archive. */
export async function extractMxl(data: Uint8Array): Promise<string> {
  const entries = listEntries(data);
  const dec = new TextDecoder();
  let target: Entry | undefined;
  const container = entries.find((e) => e.name === 'META-INF/container.xml');
  if (container) {
    const xml = dec.decode(await readEntry(data, container));
    const m = /<rootfile[^>]*full-path\s*=\s*["']([^"']+)["']/.exec(xml);
    if (m) target = entries.find((e) => e.name === m[1]);
  }
  target ??= entries.find((e) => !e.name.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(e.name));
  if (!target) throw new Error('No MusicXML document found inside .mxl');
  return dec.decode(await readEntry(data, target));
}
