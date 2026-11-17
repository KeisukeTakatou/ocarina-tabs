// Standalone printable HTML page around a tab sheet.

import { Arrangement } from '../arrange.ts';
import { InstrumentDef } from '../instruments.ts';
import { escapeXml } from './diagram.ts';
import { NotationOptions, Notation, renderNotation } from './notation.ts';

export function renderHtml(arr: Arrangement, inst: InstrumentDef, opts: NotationOptions & { notation?: Notation } = {}): string {
  const { svg } = renderNotation(arr, inst, opts.notation ?? 'tabs', { width: 800, ...opts });
  const title = escapeXml(arr.title || 'Ocarina tabs');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f4f6f9; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 840px; margin: 24px auto; padding: 0 16px; }
  .sheet { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
  .sheet svg { display: block; width: 100%; height: auto; }
  @media screen and (prefers-color-scheme: dark) {
    body { background: #12161c; }
    .sheet { background: #1a2029; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
  }
  @media print { body { background: #fff; } main { margin: 0; max-width: none; padding: 0; } .sheet { box-shadow: none; } }
</style>
</head>
<body><main><div class="sheet">${svg}</div></main></body>
</html>
`;
}
