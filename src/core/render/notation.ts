// Choose what to draw: fingering tabs, staff notation, or both (staff above tabs in one file).

import { Arrangement } from '../arrange.ts';
import { InstrumentDef } from '../instruments.ts';
import { renderTabSheet, SheetOptions, SheetResult } from './sheet.ts';
import { renderStaffSvg, StaffOptions } from './staff.ts';

export type Notation = 'tabs' | 'staff' | 'both';

export type NotationOptions = SheetOptions & StaffOptions;

/** Stack several SVG sheets vertically into one SVG (each keeps its own styles). */
export function stackSvgs(parts: SheetResult[], gap = 0): SheetResult {
  const width = Math.max(...parts.map((p) => p.width));
  let y = 0;
  const inner = parts.map((p, i) => {
    const s = p.svg.replace('<svg xmlns="http://www.w3.org/2000/svg" ', `<svg x="0" y="${y}" `);
    y += p.height + (i < parts.length - 1 ? gap : 0);
    return s;
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${y}" width="${width}" height="${y}">${inner.join('')}</svg>`, width, height: y };
}

export function renderNotation(arr: Arrangement, inst: InstrumentDef, notation: Notation, opts: NotationOptions = {}): SheetResult {
  if (notation === 'tabs') return renderTabSheet(arr, inst, opts);
  if (notation === 'staff') return renderStaffSvg(arr, opts);
  const staff = renderStaffSvg(arr, opts);
  const tabs = renderTabSheet(arr, inst, { ...opts, width: staff.width, showHeader: false });
  return stackSvgs([staff, tabs]);
}
