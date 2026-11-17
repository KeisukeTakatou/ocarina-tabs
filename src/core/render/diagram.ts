// SVG fingering diagrams as plain strings (no DOM) — usable in Node, browsers and WebViews.

import { cleanHoles, InstrumentDef } from '../instruments.ts';

export interface DiagramTheme {
  body: string;
  bodyStroke: string;
  closed: string;
  open: string;
  holeStroke: string;
  backStroke: string;
  /** Card behind 'ink' drawings, so outlines and thumb holes read on dark pages too. */
  paper: string;
}

export const LIGHT_THEME: DiagramTheme = {
  body: '#dfe7f1',
  bodyStroke: '#5b6b80',
  closed: '#1f2a37',
  open: '#ffffff',
  holeStroke: '#1f2a37',
  backStroke: '#5b6b80',
  paper: '#ffffff',
};

/** Theme using CSS variables, for inline SVG in the app (follows light/dark mode). */
export const CSS_THEME: DiagramTheme = {
  body: 'var(--oc-body)',
  bodyStroke: 'var(--oc-body-stroke)',
  closed: 'var(--oc-closed)',
  open: 'var(--oc-open)',
  holeStroke: 'var(--oc-closed)',
  backStroke: 'var(--oc-body-stroke)',
  paper: 'var(--oc-paper)',
};

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Inner SVG markup of one diagram, drawn in the instrument's own viewBox units.
 * Wrap it with <svg viewBox> or a <g transform> to place it.
 */
export function diagramMarkup(inst: InstrumentDef, holes: string, theme: DiagramTheme = LIGHT_THEME): string {
  const s = cleanHoles(holes);
  const d = inst.drawing;
  const ink = d.look === 'ink';
  const [vw, vh] = d.viewBox;
  const parts: string[] = [];
  if (ink) {
    parts.push(`<rect x="0" y="0" width="${vw}" height="${vh}" rx="${f(Math.min(vw, vh) * 0.06)}" fill="${theme.paper}"/>`);
    parts.push(`<path d="${d.body}" fill="${theme.paper}" stroke="${theme.closed}" stroke-width="${f(d.stroke ?? 1.4)}" stroke-linejoin="round"/>`);
  } else {
    parts.push(`<path d="${d.body}" fill="${theme.body}" stroke="${theme.bodyStroke}" stroke-width="${f(d.stroke ?? 1.4)}"/>`);
  }
  inst.holes.forEach((h, i) => {
    const st = s[i] ?? 'O';
    // 'ink' drawings show thumb holes like the others (below the body); 'soft' ones dash them on a pad.
    const backLook = h.back && !ink;
    const stroke = backLook ? theme.backStroke : theme.holeStroke;
    const dash = backLook ? ' stroke-dasharray="2 1.5"' : '';
    const sw = d.holeStroke ?? (h.r < 4 ? 0.9 : 1.3);
    const fill = st === 'X' ? theme.closed : theme.open;
    // Thumb holes sit outside the body outline: give them a small backing pad so they read on any background.
    if (backLook) parts.push(`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="${f(h.r + 2.4)}" fill="${theme.body}" stroke="${theme.bodyStroke}" stroke-width="0.8"/>`);
    parts.push(`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="${f(h.r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}><title>${h.label}: ${st === 'X' ? 'covered' : st === 'H' ? 'half' : 'open'}</title></circle>`);
    if (st === 'H') {
      // Lower half filled.
      parts.push(`<path d="M${f(h.x - h.r)},${f(h.y)} A${f(h.r)},${f(h.r)} 0 0 0 ${f(h.x + h.r)},${f(h.y)} Z" fill="${theme.closed}"/>`);
    }
  });
  return parts.join('');
}

/** Standalone SVG for one fingering. */
export function renderFingeringSvg(
  inst: InstrumentDef,
  holes: string,
  opts: { width?: number; theme?: DiagramTheme; label?: string } = {},
): string {
  const [vw, vh] = inst.drawing.viewBox;
  const width = opts.width ?? 120;
  const height = (width * vh) / vw;
  const title = opts.label ? `<title>${escapeXml(opts.label)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${f(width)}" height="${f(height)}" role="img">${title}${diagramMarkup(inst, holes, opts.theme)}</svg>`;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}
