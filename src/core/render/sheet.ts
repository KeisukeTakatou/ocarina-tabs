// Printable tab sheet: one fingering diagram per note, grouped in measures, wrapped into rows.

import { Arrangement, TabEvent } from '../arrange.ts';
import { InstrumentDef } from '../instruments.ts';
import { keyPrefersFlats, midiToName, toFraction } from '../pitch.ts';
import { adaptiveStyle, diagramMarkup, DiagramTheme, escapeXml, LIGHT_TEXT, LIGHT_THEME } from './diagram.ts';

export type NameMode = 'concert' | 'fingering' | 'both' | 'none';

export interface SheetOptions {
  width?: number;
  /** Diagram width in px (default depends on instrument and style). */
  diagramWidth?: number;
  /** Multiplies the diagram size (default 1). */
  scale?: number;
  names?: NameMode;
  showDurations?: boolean;
  showLyrics?: boolean;
  showHeader?: boolean;
  /** Diagram colours (default LIGHT_THEME). The app passes CSS_THEME to use its own CSS variables. */
  theme?: DiagramTheme;
  textColor?: string;
  mutedColor?: string;
  warnColor?: string;
  errorColor?: string;
  /** Background colour. Default: none (transparent). */
  background?: string | null;
  /**
   * Embed a <style> that switches to dark colours when the viewer prefers dark mode.
   * Default: true when there is no background colour.
   */
  adaptive?: boolean;
  fontFamily?: string;
}

/** Size and markup of one diagram, shared by the tab sheet and the chart. */
function diagramDrawer(inst: InstrumentDef, factor: number, opts: { diagramWidth?: number; scale?: number; theme?: DiagramTheme }) {
  const [vw, vh] = inst.drawing.viewBox;
  const scale = Math.min(4, Math.max(0.4, opts.scale ?? 1));
  const base = opts.diagramWidth ?? (inst.drawing.size ?? (vw > vh * 1.4 ? 80 : 54)) * factor;
  const dw = base * scale;
  const dh = (dw * vh) / vw;
  const k = Math.round((dw / vw) * 10000) / 10000;
  const theme = opts.theme ?? LIGHT_THEME;
  const draw = (holes: string, x: number, y: number) => `<g transform="translate(${r1(x)},${r1(y)}) scale(${k})">${diagramMarkup(inst, holes, theme)}</g>`;
  return { dw, dh, draw };
}

export interface SheetResult {
  svg: string;
  width: number;
  height: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Optional background rect and dark-mode style shared by the sheet and the chart. */
export function sheetChrome(opts: { background?: string | null; adaptive?: boolean }): string {
  const bg = opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : '';
  const adaptive = opts.adaptive ?? !opts.background;
  return (adaptive ? adaptiveStyle() : '') + bg;
}

export function voiceLabel(tonic: number): string {
  // Alto window F4..E5 (65..76)
  if (tonic >= 77) return 'Soprano';
  if (tonic <= 64) return 'Bass';
  return 'Alto';
}

export function describeArrangement(arr: Arrangement): string {
  const key = arr.tonicName.replace(/-?\d+$/, '');
  const bits = [`${arr.instrument.name} · ${voiceLabel(arr.tonic)} ${key} (tonic ${arr.tonicName})`];
  if (arr.transpose) bits.push(`transposed ${arr.transpose > 0 ? '+' : ''}${arr.transpose} semitone${Math.abs(arr.transpose) === 1 ? '' : 's'}`);
  bits.push(`♩ = ${Math.round(arr.tempo)}`, `${arr.timeSignature[0]}/${arr.timeSignature[1]}`);
  return bits.join(' · ');
}

export function durationLabel(d: number): string {
  const [n, den] = toFraction(d);
  return den === 1 ? `${n}` : `${n}/${den}`;
}

/** Title, composer and arrangement line, centred; wraps on narrow sheets. Returns the y below it. */
export function sheetHeader(arr: Arrangement, W: number, top: number, colors: { text: string; muted: string }, pad = 20): { markup: string; y: number } {
  const { text, muted } = colors;
  const parts: string[] = [];
  let y = top;
  const title = arr.title || 'Untitled';
  parts.push(`<text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-size="20" font-weight="600" class="oc-f-text" fill="${text}">${escapeXml(title)}</text>`);
  y += 26;
  if (arr.composer) {
    parts.push(`<text x="${W / 2}" y="${y + 12}" text-anchor="middle" font-size="12" class="oc-f-muted" fill="${muted}">${escapeXml(arr.composer)}</text>`);
    y += 16;
  }
  // Wrap the description onto several lines on narrow sheets (≈6.3px per char at 12px).
  const bits = describeArrangement(arr).split(' · ');
  const maxChars = Math.floor((W - 2 * pad) / 6.3);
  const lines: string[] = [];
  for (const b of bits) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' · ' + b).length <= maxChars) lines[lines.length - 1] = last + ' · ' + b;
    else lines.push(b);
  }
  for (const line of lines) {
    parts.push(`<text x="${W / 2}" y="${y + 12}" text-anchor="middle" font-size="12" class="oc-f-muted" fill="${muted}">${escapeXml(line)}</text>`);
    y += 16;
  }
  return { markup: parts.join(''), y: y + 10 };
}

export function renderTabSheet(arr: Arrangement, inst: InstrumentDef, opts: SheetOptions = {}): SheetResult {
  let W = Math.max(240, opts.width ?? 860);
  const pad = 20;
  const text = opts.textColor ?? LIGHT_TEXT.text;
  const muted = opts.mutedColor ?? LIGHT_TEXT.muted;
  const warn = opts.warnColor ?? LIGHT_TEXT.warn;
  const err = opts.errorColor ?? LIGHT_TEXT.err;
  const font = opts.fontFamily ?? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const names = opts.names ?? 'concert';
  const showDur = opts.showDurations ?? true;
  const showLyrics = (opts.showLyrics ?? true) && arr.events.some((e) => e.lyric);
  const { dw, dh, draw } = diagramDrawer(inst, 1, opts);
  const cellW = Math.max(dw + 6, 46);
  W = Math.max(W, Math.ceil(cellW + 2 * pad));
  const nameH = names === 'none' ? 0 : names === 'both' ? 26 : 15;
  const durH = showDur ? 9 : 0;
  const lyricH = showLyrics ? 14 : 0;
  const cellH = 6 + dh + 4 + nameH + durH + lyricH + 10;
  const barGap = 12;
  const rowGap = 8;

  const parts: string[] = [];
  let y = pad;
  if (opts.showHeader ?? true) {
    const h = sheetHeader(arr, W, y, { text, muted });
    parts.push(h.markup);
    y = h.y;
  }

  // Group events by measure.
  const measures: TabEvent[][] = [];
  for (const e of arr.events) {
    const last = measures[measures.length - 1];
    if (last && last[0].measure === e.measure) last.push(e);
    else measures.push([e]);
  }

  const left = pad;
  const right = W - pad;
  let x = left;
  let rowTop = y;
  let rowHasContent = false;
  const newRow = () => {
    rowTop += cellH + rowGap;
    x = left;
    rowHasContent = false;
  };
  const drawBar = (bx: number) => {
    parts.push(`<line x1="${r1(bx)}" y1="${r1(rowTop + 4)}" x2="${r1(bx)}" y2="${r1(rowTop + cellH - 6)}" class="oc-s-muted" stroke="${muted}" stroke-width="1" opacity="0.6"/>`);
  };

  for (const m of measures) {
    const mWidth = m.length * cellW;
    if (rowHasContent && x + barGap + mWidth > right && mWidth <= right - left) newRow();
    if (rowHasContent) {
      drawBar(x + barGap / 2);
      x += barGap;
    }
    // Measure number above first cell of the measure.
    parts.push(`<text x="${r1(x + 2)}" y="${r1(rowTop + 6)}" font-size="8" class="oc-f-muted" fill="${muted}" opacity="0.8">${m[0].measure + 1}</text>`);
    for (const e of m) {
      if (x + cellW > right + 0.5) newRow();
      parts.push(renderCell(e, x, rowTop));
      x += cellW;
      rowHasContent = true;
    }
  }

  function renderCell(e: TabEvent, cx: number, top: number): string {
    const g: string[] = [];
    const cls = `cell cell-${e.status}`;
    const tip = e.status === 'rest' ? `Rest, ${durationLabel(e.duration)} beat(s)` : `${e.concertName ?? midiToName(e.sourcePitch ?? 0)} — ${durationLabel(e.duration)} beat(s)${e.status === 'folded' ? ' (moved by an octave)' : ''}${e.status === 'out-of-range' ? ' (out of range)' : ''}`;
    g.push(`<g class="${cls}" data-index="${e.index}" data-start="${e.start}"><title>${escapeXml(tip)}</title>`);
    g.push(`<rect class="cell-bg${e.status === 'out-of-range' ? ' oc-f-err' : ''}" x="${r1(cx + 1)}" y="${r1(top)}" width="${r1(cellW - 2)}" height="${r1(cellH)}" rx="5" fill="${e.status === 'out-of-range' ? err : 'transparent'}" fill-opacity="${e.status === 'out-of-range' ? 0.08 : 0}"/>`);
    const dx = cx + (cellW - dw) / 2;
    const dy = top + 8;
    if (e.status === 'rest') {
      g.push(`<rect x="${r1(cx + cellW / 2 - 8)}" y="${r1(dy + dh / 2 - 2.5)}" width="16" height="5" rx="2.5" class="oc-f-muted" fill="${muted}" opacity="0.45"/>`);
    } else if (e.holes) {
      g.push(draw(e.holes, dx, dy));
    } else {
      g.push(`<text x="${r1(cx + cellW / 2)}" y="${r1(dy + dh / 2 + 6)}" text-anchor="middle" font-size="18" font-weight="700" class="oc-f-err" fill="${err}">?</text>`);
    }
    let ty = dy + dh + 4;
    if (names !== 'none') {
      const color = e.status === 'out-of-range' ? err : e.status === 'folded' ? warn : text;
      const role = e.status === 'rest' ? 'muted' : e.status === 'out-of-range' ? 'err' : e.status === 'folded' ? 'warn' : 'text';
      const label = e.status === 'rest' ? 'rest' : names === 'fingering' ? e.fingeringName : e.concertName ?? (e.sourcePitch !== null ? midiToName(e.sourcePitch) : '');
      ty += 11;
      const arrow = e.status === 'folded' && e.pitch !== null && e.sourcePitch !== null ? (e.pitch - arr.transpose > e.sourcePitch ? '↑' : '↓') : '';
      g.push(`<text x="${r1(cx + cellW / 2)}" y="${r1(ty)}" text-anchor="middle" font-size="11" font-weight="${e.status === 'rest' ? 400 : 600}" class="oc-f-${role}" fill="${e.status === 'rest' ? muted : color}">${escapeXml((label ?? '') + arrow)}</text>`);
      if (names === 'both' && e.status !== 'rest' && e.fingeringName) {
        ty += 11;
        g.push(`<text x="${r1(cx + cellW / 2)}" y="${r1(ty)}" text-anchor="middle" font-size="9" class="oc-f-muted" fill="${muted}">(${escapeXml(e.fingeringName)})</text>`);
      }
    }
    if (showDur) {
      ty += 6;
      const beatPx = Math.min(10, (cellW - 8) / 4);
      const len = Math.min(e.duration, 4) * beatPx;
      const bx = cx + (cellW - Math.max(len, 2)) / 2;
      const col = e.status === 'rest' ? muted : text;
      g.push(`<rect x="${r1(bx)}" y="${r1(ty - 2)}" width="${r1(Math.max(len, 2))}" height="3" rx="1.5" class="oc-f-${e.status === 'rest' ? 'muted' : 'text'}" fill="${col}" opacity="${e.status === 'rest' ? 0.35 : 0.55}"/>`);
      if (e.duration > 4) g.push(`<text x="${r1(bx + len + 2)}" y="${r1(ty + 1)}" font-size="7" class="oc-f-muted" fill="${muted}">+</text>`);
      ty += 3;
    }
    if (showLyrics && e.lyric) {
      ty += 12;
      g.push(`<text x="${r1(cx + cellW / 2)}" y="${r1(ty)}" text-anchor="middle" font-size="10" font-style="italic" class="oc-f-muted" fill="${muted}">${escapeXml(e.lyric)}</text>`);
    }
    g.push('</g>');
    return g.join('');
  }

  const height = Math.ceil(rowTop + cellH + pad);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="${escapeXml(font)}">${sheetChrome(opts)}${parts.join('')}</svg>`;
  return { svg, width: W, height };
}

/** All fingerings of an instrument (a printable reference chart). */
export function renderChartSvg(
  inst: InstrumentDef,
  tonic: number,
  opts: {
    width?: number;
    theme?: DiagramTheme;
    textColor?: string;
    mutedColor?: string;
    background?: string | null;
    adaptive?: boolean;
    fingeringNames?: boolean;
    scale?: number;
  } = {},
): SheetResult {
  const W = opts.width ?? 860;
  const text = opts.textColor ?? LIGHT_TEXT.text;
  const muted = opts.mutedColor ?? LIGHT_TEXT.muted;
  const { dw, dh, draw } = diagramDrawer(inst, 1.5, { scale: opts.scale, theme: opts.theme });
  const cellW = Math.max(dw + 18, 70);
  const cellH = dh + 40;
  const cols = Math.max(1, Math.floor((W - 20) / cellW));
  const parts: string[] = [];
  const flats = keyPrefersFlats(tonic);
  inst.fingerings.forEach((fd, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 10 + col * cellW;
    const y = 10 + row * cellH;
    const name = midiToName(tonic + fd.offset, flats);
    parts.push(draw(fd.holes, x + (cellW - dw) / 2, y));
    parts.push(`<text x="${x + cellW / 2}" y="${y + dh + 16}" text-anchor="middle" font-size="13" font-weight="600" class="oc-f-text" fill="${text}">${name}${fd.alt ? ' (alt)' : ''}</text>`);
    if (opts.fingeringNames) parts.push(`<text x="${x + cellW / 2}" y="${y + dh + 30}" text-anchor="middle" font-size="10" class="oc-f-muted" fill="${muted}">reads ${midiToName(72 + fd.offset)}</text>`);
  });
  const rows = Math.ceil(inst.fingerings.length / cols);
  const height = 20 + rows * cellH;
  const width = Math.ceil(Math.max(Math.min(W, 20 + cols * cellW), 20 + cellW));
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif">${sheetChrome(opts)}${parts.join('')}</svg>`,
    width,
    height,
  };
}
