// Tiny non-validating XML parser (enough for MusicXML). Works in Node, browsers and WebViews.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      pushText(stack, text.slice(i));
      break;
    }
    if (lt > i) pushText(stack, text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      stack[stack.length - 1].children.push(text.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
    } else if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (text.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset [...]
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = text[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
    } else if (text[lt + 1] === '/') {
      const e = text.indexOf('>', lt);
      const name = text.slice(lt + 2, e).trim();
      // Pop to the matching element (tolerates minor nesting errors).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = e < 0 ? n : e + 1;
    } else {
      // Start tag; find its end while respecting quoted attribute values.
      let j = lt + 1;
      let quote = '';
      while (j < n) {
        const c = text[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      let inner = text.slice(lt + 1, j);
      const selfClose = inner.endsWith('/');
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(inner);
      const el: XmlElement = { name: m ? m[1] : '', attrs: {}, children: [] };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(inner.slice(el.name.length)))) el.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
      i = j + 1;
    }
  }
  return root;
}

function pushText(stack: XmlElement[], raw: string) {
  if (!raw.trim()) return;
  stack[stack.length - 1].children.push(decodeEntities(raw));
}

// Query helpers -------------------------------------------------------------

export function elements(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c): c is XmlElement => typeof c !== 'string' && (name === undefined || c.name === name));
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c): c is XmlElement => typeof c !== 'string' && c.name === name);
}

export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let cur = el;
  for (const n of names) cur = child(cur, n);
  return cur;
}

export function text(el: XmlElement | undefined): string {
  if (!el) return '';
  return el.children.map((c) => (typeof c === 'string' ? c : text(c))).join('').trim();
}

export function num(el: XmlElement | undefined, fallback = 0): number {
  const v = parseFloat(text(el));
  return Number.isFinite(v) ? v : fallback;
}

export function findFirst(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of elements(el)) {
    if (c.name === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return undefined;
}
