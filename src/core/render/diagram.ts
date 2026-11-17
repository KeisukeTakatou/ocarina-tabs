// SVG fingering diagrams as plain strings (no DOM) — usable in Node, browsers and WebViews.

import { cleanHoles, InstrumentDef } from '../instruments.ts';

export interface DiagramTheme {
  body: string;
  bodyStroke: string;
  closed: string;
  open: string;
  holeStroke: string;
  backStroke: string;
}

/** Colours for the text around the diagrams on a tab sheet or chart. */
export interface TextPalette {
  text: string;
  muted: string;
  warn: string;
  err: string;
}

export const LIGHT_THEME: DiagramTheme = {
  body: '#dfe7f1',
  bodyStroke: '#5b6b80',
  closed: '#1f2a37',
  open: '#ffffff',
  holeStroke: '#1f2a37',
  backStroke: '#5b6b80',
};

/** Dark-mode colours: covered holes are light "ink" on a dark body, so the diagram reads on dark pages. */
export const DARK_THEME: DiagramTheme = {
  body: '#2b3644',
  bodyStroke: '#9fb0c4',
  closed: '#e8eef5',
  open: '#10151c',
  holeStroke: '#e8eef5',
  backStroke: '#9fb0c4',
};

export const LIGHT_TEXT: TextPalette = { text: '#1f2a37', muted: '#5b6b80', warn: '#b45309', err: '#b91c1c' };
export const DARK_TEXT: TextPalette = { text: '#e6ebf1', muted: '#93a1b3', warn: '#f0a24a', err: '#f27272' };

/**
 * Every coloured element carries a role class (oc-f-* sets fill, oc-s-* sets stroke) next to its light-mode
 * colour attributes. This <style> block switches the roles to dark colours when the viewer prefers dark mode.
 * Tools without CSS support simply show the light colours. Screen only: printing always uses the light colours.
 */
export function adaptiveStyle(dark: DiagramTheme = DARK_THEME, darkText: TextPalette = DARK_TEXT): string {
  const rules = [
    `.oc-f-body{fill:${dark.body}}`,
    `.oc-s-line{stroke:${dark.bodyStroke}}`,
    `.oc-f-ink{fill:${dark.closed}}`,
    `.oc-s-ink{stroke:${dark.holeStroke}}`,
    `.oc-f-open{fill:${dark.open}}`,
    `.oc-f-text{fill:${darkText.text}}`,
    `.oc-f-muted{fill:${darkText.muted}}`,
    `.oc-s-muted{stroke:${darkText.muted}}`,
    `.oc-s-text{stroke:${darkText.text}}`,
    `.oc-s-warn{stroke:${darkText.warn}}`,
    `.oc-s-err{stroke:${darkText.err}}`,
    `.oc-f-warn{fill:${darkText.warn}}`,
    `.oc-f-err{fill:${darkText.err}}`,
  ];
  // svg:root only matches when the SVG is opened on its own: the browser then paints a dark canvas behind it.
  return `<style>svg:root{color-scheme:light dark}@media screen and (prefers-color-scheme: dark){${rules.join('')}}</style>`;
}

/** Theme using CSS variables, for inline SVG in the app (follows light/dark mode). */
export const CSS_THEME: DiagramTheme = {
  body: 'var(--oc-body)',
  bodyStroke: 'var(--oc-body-stroke)',
  closed: 'var(--oc-closed)',
  open: 'var(--oc-open)',
  holeStroke: 'var(--oc-closed)',
  backStroke: 'var(--oc-body-stroke)',
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
  const parts: string[] = [];
  if (ink) {
    // Outline only: the body is transparent, like the picture charts it was traced from.
    parts.push(`<path class="oc-s-ink" d="${d.body}" fill="none" stroke="${theme.closed}" stroke-width="${f(d.stroke ?? 1.4)}" stroke-linejoin="round"/>`);
  } else {
    parts.push(`<path class="oc-f-body oc-s-line" d="${d.body}" fill="${theme.body}" stroke="${theme.bodyStroke}" stroke-width="${f(d.stroke ?? 1.4)}"/>`);
  }
  inst.holes.forEach((h, i) => {
    const st = s[i] ?? 'O';
    // 'ink' drawings show thumb holes like the others (below the body); 'soft' ones dash them on a pad.
    const backLook = h.back && !ink;
    const stroke = backLook ? theme.backStroke : theme.holeStroke;
    const dash = backLook ? ' stroke-dasharray="2 1.5"' : '';
    const sw = d.holeStroke ?? (h.r < 4 ? 0.9 : 1.3);
    const fill = st === 'X' ? theme.closed : theme.open;
    const cls = `${st === 'X' ? 'oc-f-ink' : 'oc-f-open'} ${backLook ? 'oc-s-line' : 'oc-s-ink'}`;
    // Thumb holes sit outside the body outline: give them a small backing pad so they read on any background.
    if (backLook) parts.push(`<circle class="oc-f-body oc-s-line" cx="${f(h.x)}" cy="${f(h.y)}" r="${f(h.r + 2.4)}" fill="${theme.body}" stroke="${theme.bodyStroke}" stroke-width="0.8"/>`);
    parts.push(`<circle class="${cls}" cx="${f(h.x)}" cy="${f(h.y)}" r="${f(h.r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}><title>${h.label}: ${st === 'X' ? 'covered' : st === 'H' ? 'half' : 'open'}</title></circle>`);
    if (st === 'H') {
      // Lower half filled.
      parts.push(`<path class="oc-f-ink" d="M${f(h.x - h.r)},${f(h.y)} A${f(h.r)},${f(h.r)} 0 0 0 ${f(h.x + h.r)},${f(h.y)} Z" fill="${theme.closed}"/>`);
    }
  });
  return parts.join('');
}

/** Standalone SVG for one fingering. */
export function renderFingeringSvg(
  inst: InstrumentDef,
  holes: string,
  opts: { width?: number; theme?: DiagramTheme; label?: string; /** Follow dark mode (default true). */ adaptive?: boolean } = {},
): string {
  const [vw, vh] = inst.drawing.viewBox;
  const width = opts.width ?? 120;
  const height = (width * vh) / vw;
  const title = opts.label ? `<title>${escapeXml(opts.label)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${f(width)}" height="${f(height)}" role="img">${title}${opts.adaptive ?? true ? adaptiveStyle() : ''}${diagramMarkup(inst, holes, opts.theme)}</svg>`;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}
