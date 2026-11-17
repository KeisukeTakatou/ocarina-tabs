import './style.css';
import {
  arrange,
  Arrangement,
  COMMON_KEYS,
  findDuplicate,
  LibraryEntry,
  LibrarySettings,
  makeEntry,
  mergeLibraries,
  parseLibrary,
  removeEntry,
  searchLibrary,
  serializeLibrary,
  upsertEntry,
  CSS_THEME,
  describeOcarina,
  detectFormat,
  getInstrument,
  importMusic,
  ImportResult,
  InstrumentDef,
  LIGHT_THEME,
  NameMode,
  parseAbc,
  parseSimple,
  renderChartSvg,
  renderHtml,
  Notation,
  renderNotation,
  renderStaffSvg,
  renderTabSheet,
  renderText,
  resolveTonic,
  Score,
  scoreToSimple,
  suggestOcarinas,
  Suggestion,
  TransposeMode,
  Voice,
  writeMidi,
} from '../core/index.ts';
import { Player } from './audio.ts';
import odeText from '../../examples/ode-to-joy.txt?raw';
import graceAbc from '../../examples/amazing-grace.abc?raw';
import twinkleXml from '../../examples/twinkle.musicxml?raw';

// ---------------------------------------------------------------------------
// State

interface Settings {
  instrument: string;
  key: string;
  voice: Voice;
  transpose: 'auto' | 'octave' | 'none' | 'manual';
  manual: number;
  oor: 'fold' | 'mark';
  names: NameMode;
  durations: boolean;
  editorMode: 'text' | 'abc';
  text: string;
  tab: 'sheet' | 'chart' | 'library';
  /** Diagram size in percent. */
  zoom: number;
  /** Keep the playing note in view. */
  autoscroll: boolean;
  /** Library entry the editor holds, if any. */
  libraryId: string | null;
  /** What the Music tab shows: fingering tabs, staff notation, or both side by side. */
  notation: Notation;
}

const DEFAULTS: Settings = {
  instrument: '12',
  key: 'C',
  voice: 'alto',
  transpose: 'auto',
  manual: 0,
  oor: 'fold',
  names: 'concert',
  durations: true,
  editorMode: 'text',
  text: odeText,
  tab: 'sheet',
  zoom: 100,
  autoscroll: true,
  libraryId: null,
  notation: 'tabs',
};

const STORE_KEY = 'ocarina-tabs:v1';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, 300);
}

const state: Settings = loadSettings();
if (state.tab !== 'sheet' && state.tab !== 'chart' && state.tab !== 'library') state.tab = 'sheet';
if (state.notation !== 'tabs' && state.notation !== 'staff' && state.notation !== 'both') state.notation = 'tabs';

// ---------------------------------------------------------------------------
// Library (saved songs), kept in localStorage separately from the settings.

const LIBRARY_KEY = 'ocarina-tabs:library:v1';

function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? parseLibrary(raw) : [];
  } catch {
    return [];
  }
}

let library: LibraryEntry[] = loadLibrary();
if (state.libraryId && !library.some((e) => e.id === state.libraryId)) state.libraryId = null;

function storeLibrary(): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, serializeLibrary(library));
    return true;
  } catch {
    toast('Could not save the library in this browser (storage is full or blocked). Use Back up to keep a copy.');
    return false;
  }
}

/** Binary source (MIDI / MusicXML) kept so another track/part can be chosen. */
let source: { name: string; data: Uint8Array | string; result: ImportResult; pick?: number } | null = null;
let current: { score: Score; arr: Arrangement; inst: InstrumentDef } | null = null;
const player = new Player();

// ---------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  file: $<HTMLInputElement>('file'),
  example: $<HTMLSelectElement>('example'),
  play: $<HTMLButtonElement>('play'),
  autoscroll: $<HTMLButtonElement>('autoscroll'),
  exportBtn: $<HTMLButtonElement>('export-btn'),
  exportMenu: $<HTMLDivElement>('export-menu'),
  drop: $<HTMLDivElement>('drop'),
  sourceInfo: $<HTMLDivElement>('source-info'),
  sourceSelect: $<HTMLDivElement>('source-select'),
  sourcePick: $<HTMLSelectElement>('source-pick'),
  sourcePickLabel: $<HTMLLabelElement>('source-pick-label'),
  editor: $<HTMLTextAreaElement>('editor'),
  editorMode: $<HTMLSelectElement>('editor-mode'),
  instrument: $<HTMLDivElement>('instrument'),
  key: $<HTMLSelectElement>('key'),
  voice: $<HTMLSelectElement>('voice'),
  ocDesc: $<HTMLParagraphElement>('ocarina-desc'),
  transpose: $<HTMLSelectElement>('transpose'),
  manualWrap: $<HTMLDivElement>('manual-wrap'),
  manual: $<HTMLInputElement>('manual'),
  oor: $<HTMLSelectElement>('oor'),
  names: $<HTMLSelectElement>('names'),
  durations: $<HTMLInputElement>('durations'),
  saveSong: $<HTMLButtonElement>('save-song'),
  saveNew: $<HTMLButtonElement>('save-new'),
  saveStatus: $<HTMLSpanElement>('save-status'),
  library: $<HTMLDivElement>('library'),
  libraryCount: $<HTMLSpanElement>('library-count'),
  librarySearch: $<HTMLInputElement>('library-search'),
  libraryBackup: $<HTMLButtonElement>('library-backup'),
  libraryRestore: $<HTMLInputElement>('library-restore'),
  libraryInfo: $<HTMLParagraphElement>('library-info'),
  libraryList: $<HTMLUListElement>('library-list'),
  legend: document.querySelector('.legend') as HTMLParagraphElement,
  zoom: $<HTMLInputElement>('zoom'),
  zoomIn: $<HTMLButtonElement>('zoom-in'),
  zoomOut: $<HTMLButtonElement>('zoom-out'),
  zoomValue: $<HTMLOutputElement>('zoom-value'),
  suggestions: $<HTMLOListElement>('suggestions'),
  status: $<HTMLDivElement>('status'),
  sheet: $<HTMLDivElement>('sheet'),
  chart: $<HTMLDivElement>('chart'),
  staff: $<HTMLDivElement>('staff'),
  music: $<HTMLDivElement>('music'),
  viewbar: $<HTMLDivElement>('viewbar'),
  notation: $<HTMLDivElement>('notation'),
};

for (const k of COMMON_KEYS) els.key.append(new Option(k, k));

function syncControls() {
  for (const b of els.instrument.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.instrument));
  els.key.value = state.key;
  els.voice.value = state.voice;
  els.transpose.value = state.transpose;
  els.manualWrap.hidden = state.transpose !== 'manual';
  els.manual.value = String(state.manual);
  els.oor.value = state.oor;
  els.names.value = state.names;
  els.durations.checked = state.durations;
  els.autoscroll.setAttribute('aria-pressed', String(state.autoscroll));
  els.zoom.value = String(state.zoom);
  els.zoomValue.textContent = `${state.zoom}%`;
  els.editorMode.value = state.editorMode;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  els.music.hidden = state.tab !== 'sheet';
  els.viewbar.hidden = state.tab !== 'sheet';
  els.staff.hidden = state.notation === 'tabs';
  els.sheet.hidden = state.notation === 'staff';
  els.music.classList.toggle('both', state.notation === 'both');
  for (const b of els.notation.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.notation));
  els.chart.hidden = state.tab !== 'chart';
  els.library.hidden = state.tab !== 'library';
  els.status.hidden = state.tab === 'library';
  els.legend.hidden = state.tab === 'library' || (state.tab === 'sheet' && state.notation === 'staff');
}

// ---------------------------------------------------------------------------
// Pipeline

function parseEditor(): Score {
  const txt = els.editor.value;
  return state.editorMode === 'abc' ? parseAbc(txt) : parseSimple(txt);
}

function transposeMode(): TransposeMode {
  return state.transpose === 'manual' ? state.manual : state.transpose;
}

function update() {
  const inst = getInstrument(state.instrument);
  const tonic = resolveTonic(state.key, state.voice);
  els.ocDesc.textContent = describeOcarina({ instrument: inst, tonic });
  let score: Score;
  try {
    score = parseEditor();
  } catch (e) {
    els.status.innerHTML = `<span class="pill err">${escapeHtml((e as Error).message)}</span>`;
    return;
  }
  if (source && score.title === undefined) score.title = source.result.score.title;
  const arr = arrange(score, { instrument: inst, tonic }, { transpose: transposeMode(), outOfRange: state.oor });
  current = { score, arr, inst };
  renderStatus(arr);
  renderSheet();
  renderChart();
  renderSuggestions(score);
  renderSaveState();
  saveSettings();
}

function renderStatus(arr: Arrangement) {
  const s = arr.stats;
  if (!s.notes) {
    els.status.innerHTML = '';
    return;
  }
  const pills: string[] = [];
  pills.push(`<span class="pill">${s.notes} notes</span>`);
  if (s.lowest && s.highest) pills.push(`<span class="pill">${s.lowest}–${s.highest}</span>`);
  if (arr.transpose) pills.push(`<span class="pill">Transposed ${arr.transpose > 0 ? '+' : ''}${arr.transpose}</span>`);
  if (!s.folded && !s.outOfRange) pills.push('<span class="pill ok">✓ All notes playable</span>');
  if (s.folded) pills.push(`<span class="pill warn">${s.folded} moved by an octave</span>`);
  if (s.outOfRange) pills.push(`<span class="pill err">${s.outOfRange} not playable</span>`);
  if (s.halfHoles) pills.push(`<span class="pill">${s.halfHoles} half-hole note${s.halfHoles > 1 ? 's' : ''}</span>`);
  const warnings = arr.warnings.filter((w) => !/moved by an octave|cannot be played/.test(w));
  const list = warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
  els.status.innerHTML = pills.join('') + list;
}

function sheetWidth(el: HTMLElement): number {
  const w = el.clientWidth || el.parentElement?.clientWidth || 800;
  return Math.max(300, Math.min(1100, w - 8));
}

const scale = () => state.zoom / 100;

/** Render the Music tab: the staff and/or the fingering tabs, whichever are shown. */
function renderSheet() {
  if (!current) return;
  const { arr, inst } = current;
  if (!arr.events.length) {
    const empty = '<div class="empty">Open a file or type some notes to see fingerings.</div>';
    els.sheet.innerHTML = empty;
    els.staff.innerHTML = empty;
    return;
  }
  if (!els.staff.hidden) {
    els.staff.innerHTML = renderStaffSvg(arr, {
      width: sheetWidth(els.staff),
      scale: scale(),
      textColor: 'var(--text)',
      mutedColor: 'var(--muted)',
      warnColor: 'var(--warn)',
      errorColor: 'var(--err)',
      background: null,
      adaptive: false,
    }).svg;
  }
  if (els.sheet.hidden) return;
  const { svg } = renderTabSheet(arr, inst, {
    width: sheetWidth(els.sheet),
    // Side by side: the title is already above the sheet music.
    showHeader: state.notation !== 'both',
    names: state.names,
    showDurations: state.durations,
    scale: scale(),
    theme: CSS_THEME,
    textColor: 'var(--text)',
    mutedColor: 'var(--muted)',
    warnColor: 'var(--warn)',
    errorColor: 'var(--err)',
    background: null,
    // The page's own CSS variables already follow light/dark mode.
    adaptive: false,
  });
  els.sheet.innerHTML = svg;
}

function renderChart() {
  if (!current || state.tab !== 'chart') return;
  const tonic = resolveTonic(state.key, state.voice);
  const { svg } = renderChartSvg(current.inst, tonic, {
    width: sheetWidth(els.chart),
    scale: scale(),
    theme: CSS_THEME,
    textColor: 'var(--text)',
    mutedColor: 'var(--muted)',
    background: null,
    adaptive: false,
    fingeringNames: state.key !== 'C',
  });
  els.chart.innerHTML = svg;
}

function renderSuggestions(score: Score) {
  let list: Suggestion[] = suggestOcarinas(score, { transpose: 'none', limit: 40 }).filter((s) => s.outOfRange === 0);
  let mode: Settings['transpose'] = 'none';
  const hint = els.suggestions.previousElementSibling as HTMLElement;
  if (!list.length) {
    list = suggestOcarinas(score, { transpose: 'octave', limit: 40 }).filter((s) => s.outOfRange === 0);
    mode = 'octave';
    hint.textContent = list.length ? 'Nothing fits at the written pitch; these fit when moved by octaves.' : 'No single ocarina covers this range — notes will be moved by octaves.';
  } else hint.textContent = 'Played as written, no transposing. Tap one to use it.';
  // One entry per instrument/key/voice; prefer fewer half holes, show the top few per hole count.
  const picked: Suggestion[] = [];
  for (const id of ['12', '6', '4']) picked.push(...list.filter((s) => s.instrument === id).slice(0, 2));
  picked.sort((a, b) => a.cost - b.cost);
  els.suggestions.innerHTML = '';
  if (!picked.length) {
    els.suggestions.innerHTML = '<li class="empty">—</li>';
    return;
  }
  for (const s of picked.slice(0, 6)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const isCurrent = s.instrument === state.instrument && s.key === state.key && s.voice === state.voice;
    if (isCurrent) b.classList.add('current');
    b.innerHTML = `<span>${s.instrument}-hole · ${cap(s.voice)} ${s.key}</span><span class="meta">${s.halfHoles ? `${s.halfHoles} half-hole` : 'no half-holes'}${s.transpose ? ` · ${s.transpose > 0 ? '+' : ''}${s.transpose / 12} oct` : ''}</span>`;
    b.addEventListener('click', () => {
      state.instrument = s.instrument;
      state.key = s.key;
      state.voice = s.voice;
      state.transpose = mode;
      syncControls();
      update();
    });
    li.append(b);
    els.suggestions.append(li);
  }
}

// ---------------------------------------------------------------------------
// Loading files

/**
 * Load a song into the editor. `save`: 'new' adds an imported file to the library (or reuses an identical
 * saved song), 'update' rewrites the open library entry (another track of the same file), false leaves the
 * library alone (examples).
 */
async function loadData(name: string, data: Uint8Array | string, pick?: number, save: 'new' | 'update' | false = false) {
  stopPlayback();
  try {
    const sel: { track?: number; part?: number } = {};
    if (pick !== undefined) {
      if (detectFormat(name, data) === 'midi') sel.track = pick;
      else sel.part = pick;
    }
    const result = await importMusic(data, name, sel);
    const format = result.format;
    if (format === 'abc') {
      source = null;
      state.editorMode = 'abc';
      els.editor.value = typeof data === 'string' ? data : new TextDecoder().decode(data);
    } else if (format === 'text') {
      source = null;
      state.editorMode = 'text';
      els.editor.value = typeof data === 'string' ? data : new TextDecoder().decode(data);
    } else {
      source = { name, data, result, pick };
      state.editorMode = 'text';
      els.editor.value = scoreToSimple(result.score);
    }
    state.text = els.editor.value;
    if (save !== 'update') state.libraryId = null;
    renderSourceInfo(name);
    syncControls();
    update();
    if (save) saveToLibrary({ source: name, quiet: save === 'update' });
  } catch (e) {
    toast(`Could not read ${name}: ${(e as Error).message}`);
  }
}

function renderSourceInfo(name: string) {
  if (!source) {
    els.sourceInfo.textContent = name ? `Loaded ${name}` : '';
    els.sourceSelect.hidden = true;
    return;
  }
  const r = source.result;
  const label = r.format === 'midi' ? 'MIDI' : 'MusicXML';
  els.sourceInfo.textContent = `${name} · ${label} — converted to note text below (edit freely).`;
  els.sourcePick.innerHTML = '';
  if (r.midiTracks && r.midiTracks.length > 1) {
    els.sourcePickLabel.textContent = 'Melody track';
    for (const t of r.midiTracks) els.sourcePick.append(new Option(`${t.index}: ${t.name} (${t.notes} notes)${t.drums ? ' – drums' : ''}`, String(t.index)));
    els.sourcePick.value = String(source.pick ?? r.selectedTrack ?? '');
    els.sourceSelect.hidden = false;
  } else if (r.musicXmlParts && r.musicXmlParts.length > 1) {
    els.sourcePickLabel.textContent = 'Part';
    for (const p of r.musicXmlParts) els.sourcePick.append(new Option(`${p.name} (${p.notes} notes)`, String(p.index)));
    els.sourcePick.value = String(source.pick ?? r.musicXmlParts.find((p) => p.notes > 0)?.index ?? 0);
    els.sourceSelect.hidden = false;
  } else els.sourceSelect.hidden = true;
}

async function loadFile(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  await loadData(file.name, data, undefined, 'new');
}

// ---------------------------------------------------------------------------
// Library UI

function currentSettings(): LibrarySettings {
  return { instrument: state.instrument, key: state.key, voice: state.voice, transpose: state.transpose, manual: state.manual, oor: state.oor };
}

function openEntry(): LibraryEntry | undefined {
  return state.libraryId ? library.find((e) => e.id === state.libraryId) : undefined;
}

/** Save the editor's song: update the open library entry, or add a new one (unless the same melody is already saved). */
function saveToLibrary(opts: { source?: string; asNew?: boolean; quiet?: boolean } = {}) {
  const text = els.editor.value;
  if (!text.trim()) {
    toast('Nothing to save yet: type or open a song first.');
    return;
  }
  const mode = state.editorMode;
  const open = opts.asNew ? undefined : openEntry();
  const duplicate = open ? undefined : findDuplicate(library, text, mode);
  const existing = open ?? duplicate;
  const entry = makeEntry({
    id: existing?.id,
    text,
    mode,
    source: opts.source ?? existing?.source,
    settings: currentSettings(),
    fallbackTitle: existing?.title ?? current?.arr.title,
  });
  library = upsertEntry(library, entry);
  state.libraryId = entry.id;
  const stored = storeLibrary();
  saveSettings();
  renderSaveState();
  renderLibrary();
  if (stored && !opts.quiet) toast(duplicate ? `Already in your library: ${entry.title}` : `Saved to library: ${entry.title}`);
}

function renderSaveState() {
  const open = openEntry();
  const dirty = !!open && (open.text !== els.editor.value || open.mode !== state.editorMode);
  els.saveSong.textContent = !open ? '☆ Save to library' : dirty ? '☆ Save changes' : '★ Saved';
  els.saveSong.disabled = !!open && !dirty;
  els.saveNew.hidden = !dirty;
  els.saveStatus.textContent = open ? (dirty ? `Unsaved changes to "${open.title}"` : `In your library as "${open.title}"`) : '';
}

const KEYS = new Set<string>(COMMON_KEYS);

/** Reopen a saved song with the ocarina settings it was saved with. */
function openFromLibrary(id: string) {
  const e = library.find((x) => x.id === id);
  if (!e) return;
  stopPlayback();
  source = null;
  const st = e.settings ?? {};
  if (st.instrument && ['4', '6', '12'].includes(st.instrument)) state.instrument = st.instrument;
  if (st.key && KEYS.has(st.key)) state.key = st.key;
  if (st.voice === 'soprano' || st.voice === 'alto' || st.voice === 'bass') state.voice = st.voice;
  if (st.transpose === 'auto' || st.transpose === 'octave' || st.transpose === 'none' || st.transpose === 'manual') state.transpose = st.transpose;
  if (typeof st.manual === 'number') state.manual = st.manual;
  if (st.oor === 'fold' || st.oor === 'mark') state.oor = st.oor;
  state.editorMode = e.mode;
  els.editor.value = e.text;
  state.text = e.text;
  state.libraryId = e.id;
  state.tab = 'sheet';
  renderSourceInfo(`"${e.title}" from your library`);
  syncControls();
  update();
  renderLibrary();
  window.scrollTo({ top: 0 });
}

function deleteFromLibrary(id: string) {
  const e = library.find((x) => x.id === id);
  if (!e) return;
  if (!window.confirm(`Delete "${e.title}" from the library? This cannot be undone unless you have a backup.`)) return;
  library = removeEntry(library, id);
  if (state.libraryId === id) state.libraryId = null;
  storeLibrary();
  saveSettings();
  renderSaveState();
  renderLibrary();
}

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s >= 2592000) return new Date(t).toLocaleDateString();
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  let [div, name] = units[0];
  for (const u of units) if (s >= u[0]) [div, name] = u;
  const n = Math.floor(s / div);
  return `${n} ${name}${n === 1 ? '' : 's'} ago`;
}

function describeSettings(st?: LibrarySettings): string {
  if (!st?.instrument) return '';
  const voice = st.voice ? cap(st.voice) + ' ' : '';
  return `${st.instrument}-hole ${voice}${st.key ?? ''}`.trim();
}

function renderLibrary() {
  els.libraryCount.textContent = library.length ? String(library.length) : '';
  if (state.tab !== 'library') return;
  const q = els.librarySearch.value;
  const list = searchLibrary(library, q);
  if (!library.length) {
    els.libraryInfo.textContent = 'No saved songs yet. Files you open are saved here automatically; for a typed song press "Save to library".';
  } else if (!list.length) {
    els.libraryInfo.textContent = `No saved song matches "${q}".`;
  } else {
    const n = list.length === library.length ? `${library.length}` : `${list.length} of ${library.length}`;
    els.libraryInfo.textContent = `${n} saved song${library.length === 1 ? '' : 's'} · stored in this browser, use Back up to keep a copy.`;
  }
  els.libraryList.innerHTML = list
    .map((e) => {
      const meta = [e.composer, `${e.notes} notes`, e.range, describeSettings(e.settings), e.source, `saved ${timeAgo(e.updated)}`].filter(Boolean).join(' · ');
      return `<li class="song${e.id === state.libraryId ? ' current' : ''}" data-id="${escapeHtml(e.id)}">
  <button type="button" class="song-open" data-action="open"><span class="song-title">${escapeHtml(e.title)}</span><span class="song-meta">${escapeHtml(meta)}</span></button>
  <button type="button" class="song-del" data-action="delete" aria-label="Delete ${escapeHtml(e.title)}" title="Delete">✕</button>
</li>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Playback

function stopPlayback() {
  player.stop();
  els.play.textContent = '▶ Play';
  highlight(null);
}

// Auto-scroll: while playing, each new row of the sheet is scrolled to about a third of the way down
// the screen. Scrolling by hand pauses it for a few seconds so the reader can look around.
// In side-by-side view each pane scrolls on its own; otherwise the page scrolls.
const lastRowTop = new Map<Element, number>();
let userScrolledAt = 0;
let programmaticScrollUntil = 0;

function scrollsItself(el: HTMLElement): boolean {
  const o = getComputedStyle(el).overflowY;
  return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 2;
}

function followCell(pane: HTMLElement, cell: Element) {
  if (!state.autoscroll || Date.now() - userScrolledAt < 4000) return;
  const rect = cell.getBoundingClientRect();
  if (scrollsItself(pane)) {
    const pr = pane.getBoundingClientRect();
    const rowTop = Math.round(rect.top - pr.top + pane.scrollTop);
    const offScreen = rect.top < pr.top || rect.bottom > pr.bottom;
    if (rowTop === lastRowTop.get(pane) && !offScreen) return;
    lastRowTop.set(pane, rowTop);
    const target = Math.max(0, rowTop - pane.clientHeight * 0.3);
    if (Math.abs(target - pane.scrollTop) < 4) return;
    programmaticScrollUntil = Date.now() + 900;
    pane.scrollTo({ top: target, behavior: 'smooth' });
    return;
  }
  const rowTop = Math.round(rect.top + window.scrollY);
  const offScreen = rect.top < 60 || rect.bottom > window.innerHeight - 20;
  if (rowTop === lastRowTop.get(document.documentElement) && !offScreen) return;
  lastRowTop.set(document.documentElement, rowTop);
  const target = Math.max(0, rowTop - window.innerHeight * 0.3);
  if (Math.abs(target - window.scrollY) < 4) return;
  programmaticScrollUntil = Date.now() + 900;
  window.scrollTo({ top: target, behavior: 'smooth' });
}

function onUserScroll() {
  if (player.playing && Date.now() > programmaticScrollUntil) userScrolledAt = Date.now();
}
window.addEventListener('wheel', onUserScroll, { passive: true });
window.addEventListener('touchmove', onUserScroll, { passive: true });
window.addEventListener('keydown', (e) => {
  if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key) && e.target === document.body) onUserScroll();
});

const visiblePanes = () => [els.staff, els.sheet].filter((p) => !p.hidden);

/** Mark the note in every visible pane (a tied note can have several cells) and keep it in view. */
function highlight(index: number | null) {
  for (const p of [els.staff, els.sheet]) for (const c of p.querySelectorAll('.cell.playing')) c.classList.remove('playing');
  if (index === null) {
    lastRowTop.clear();
    return;
  }
  for (const p of visiblePanes()) {
    const cells = p.querySelectorAll(`.cell[data-index="${index}"]`);
    cells.forEach((c) => c.classList.add('playing'));
    if (cells[0] && player.playing) followCell(p, cells[0]);
  }
}

function startPlayback(fromBeat = 0) {
  if (!current) return;
  lastRowTop.clear();
  userScrolledAt = 0;
  if (state.tab !== 'sheet') {
    state.tab = 'sheet';
    syncControls();
    renderSheet();
  }
  const notes = current.arr.events.map((e) => ({ index: e.index, pitch: e.status === 'out-of-range' ? null : e.pitch, start: e.start, duration: e.duration }));
  els.play.textContent = '■ Stop';
  void player.play(notes, current.arr.tempo, highlight, stopPlayback, fromBeat);
}

// ---------------------------------------------------------------------------
// Export

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName(): string {
  return (current?.arr.title || 'ocarina-tabs').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'ocarina-tabs';
}

async function doExport(kind: string) {
  if (!current) return;
  const { arr, inst, score } = current;
  const fixed = { width: 860, names: state.names, showDurations: state.durations, theme: LIGHT_THEME, scale: scale() };
  const name = `${baseName()}-${inst.id}h-${state.key}`;
  switch (kind) {
    case 'svg':
      download(`${name}.svg`, renderNotation(arr, inst, state.notation, fixed).svg, 'image/svg+xml');
      break;
    case 'png': {
      // A PNG can't follow dark mode, so it gets a white page.
      const { svg, width, height } = renderNotation(arr, inst, state.notation, { ...fixed, background: '#ffffff' });
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => b && download(`${name}.png`, b, 'image/png'), 'image/png');
      break;
    }
    case 'html':
      download(`${name}.html`, renderHtml(arr, inst, { ...fixed, notation: state.notation }), 'text/html');
      break;
    case 'print':
      state.tab = 'sheet';
      syncControls();
      renderSheet();
      setTimeout(() => window.print(), 50);
      break;
    case 'txt':
      download(`${name}.txt`, renderText(arr, inst, { names: state.names }), 'text/plain;charset=utf-8');
      break;
    case 'notes': {
      const s: Score = { ...score, notes: arr.events.map((e) => ({ pitch: e.status === 'out-of-range' ? null : e.pitch, start: e.start, duration: e.duration, lyric: e.lyric })) };
      download(`${name}.txt`, scoreToSimple(s), 'text/plain;charset=utf-8');
      break;
    }
    case 'midi': {
      const bytes = writeMidi(arr.events.map((e) => ({ pitch: e.status === 'out-of-range' ? null : e.pitch, start: e.start, duration: e.duration })), { tempo: arr.tempo, timeSignature: arr.timeSignature });
      download(`${name}.mid`, bytes as Uint8Array<ArrayBuffer>, 'audio/midi');
      break;
    }
    case 'json':
      download(`${name}.json`, JSON.stringify({ holeOrder: inst.holes.map((h) => h.id), arrangement: arr }, null, 2), 'application/json');
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers

function escapeHtml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
}
function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
let toastTimer = 0;
function toast(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 4000);
}
function debounce(fn: () => void, ms: number) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

// ---------------------------------------------------------------------------
// Events

els.instrument.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.value) return;
  state.instrument = b.dataset.value;
  syncControls();
  update();
});
els.key.addEventListener('change', () => {
  state.key = els.key.value;
  update();
});
els.voice.addEventListener('change', () => {
  state.voice = els.voice.value as Voice;
  update();
});
els.transpose.addEventListener('change', () => {
  state.transpose = els.transpose.value as Settings['transpose'];
  if (state.transpose === 'manual' && current) state.manual = current.arr.transpose;
  syncControls();
  update();
});
els.manual.addEventListener('input', () => {
  state.manual = parseInt(els.manual.value, 10) || 0;
  update();
});
els.oor.addEventListener('change', () => {
  state.oor = els.oor.value as Settings['oor'];
  update();
});
els.names.addEventListener('change', () => {
  state.names = els.names.value as NameMode;
  update();
});
els.durations.addEventListener('change', () => {
  state.durations = els.durations.checked;
  update();
});
function setZoom(z: number) {
  state.zoom = Math.min(300, Math.max(50, Math.round(z / 10) * 10));
  syncControls();
  renderSheet();
  renderChart();
  saveSettings();
}
els.zoom.addEventListener('input', () => setZoom(parseInt(els.zoom.value, 10) || 100));
els.zoomIn.addEventListener('click', () => setZoom(state.zoom + 10));
els.zoomOut.addEventListener('click', () => setZoom(state.zoom - 10));
// Ctrl/⌘ + wheel over the sheet resizes the diagrams instead of the page.
for (const el of [els.sheet, els.staff, els.chart]) {
  el.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(state.zoom + (e.deltaY < 0 ? 10 : -10));
    },
    { passive: false },
  );
}
els.editorMode.addEventListener('change', () => {
  state.editorMode = els.editorMode.value as Settings['editorMode'];
  update();
});
const onEdit = debounce(() => {
  state.text = els.editor.value;
  update();
}, 250);
els.editor.addEventListener('input', onEdit);

els.sourcePick.addEventListener('change', () => {
  if (source) void loadData(source.name, source.data, parseInt(els.sourcePick.value, 10), state.libraryId ? 'update' : false);
});

els.file.addEventListener('change', () => {
  const f = els.file.files?.[0];
  if (f) void loadFile(f);
  els.file.value = '';
});
els.example.addEventListener('change', () => {
  const v = els.example.value;
  els.example.value = '';
  if (v === 'ode') void loadData('ode-to-joy.txt', odeText);
  if (v === 'grace') void loadData('amazing-grace.abc', graceAbc);
  if (v === 'twinkle') void loadData('twinkle.musicxml', twinkleXml);
});

for (const target of [els.drop, document.body]) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.drop.classList.add('over');
  });
  target.addEventListener('dragleave', () => els.drop.classList.remove('over'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.drop.classList.remove('over');
    const f = (e as DragEvent).dataTransfer?.files[0];
    if (f) void loadFile(f);
  });
}

els.autoscroll.addEventListener('click', () => {
  state.autoscroll = !state.autoscroll;
  userScrolledAt = 0;
  lastRowTop.clear();
  syncControls();
  saveSettings();
  if (player.playing) {
    for (const p of visiblePanes()) {
      const cell = p.querySelector('.cell.playing');
      if (cell) followCell(p, cell);
    }
  }
});
els.saveSong.addEventListener('click', () => saveToLibrary());
els.saveNew.addEventListener('click', () => saveToLibrary({ asNew: true }));
els.librarySearch.addEventListener('input', renderLibrary);
els.libraryList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const id = b?.closest<HTMLLIElement>('li[data-id]')?.dataset.id;
  if (!b || !id) return;
  if (b.dataset.action === 'open') openFromLibrary(id);
  else deleteFromLibrary(id);
});
els.libraryBackup.addEventListener('click', () => {
  if (!library.length) {
    toast('The library is empty.');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  download(`ocarina-tabs-library-${date}.json`, serializeLibrary(library), 'application/json');
});
els.libraryRestore.addEventListener('change', async () => {
  const f = els.libraryRestore.files?.[0];
  els.libraryRestore.value = '';
  if (!f) return;
  try {
    const incoming = parseLibrary(await f.text());
    const r = mergeLibraries(library, incoming);
    library = r.list;
    storeLibrary();
    renderLibrary();
    renderSaveState();
    const same = incoming.length - r.added - r.updated;
    toast(`Restored ${f.name}: ${r.added} added, ${r.updated} updated${same ? `, ${same} already here` : ''}.`);
  } catch (e) {
    toast(`Could not restore ${f.name}: ${(e as Error).message}`);
  }
});

els.play.addEventListener('click', () => {
  if (player.playing) stopPlayback();
  else startPlayback();
});

const onNoteClick = (e: Event) => {
  const cell = (e.target as Element).closest<SVGGElement>('.cell');
  if (!cell || !current) return;
  const ev = current.arr.events[Number(cell.dataset.index)];
  if (player.playing) {
    stopPlayback();
    startPlayback(ev.start);
    return;
  }
  highlight(ev.index);
  if (ev.pitch !== null && ev.status !== 'out-of-range') void player.preview(ev.pitch);
};
els.sheet.addEventListener('click', onNoteClick);
els.staff.addEventListener('click', onNoteClick);

els.notation.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
  if (!b) return;
  state.notation = b.dataset.value as Notation;
  lastRowTop.clear();
  syncControls();
  renderSheet();
  saveSettings();
  // Keep the playing note marked in the newly shown pane.
  const playing = document.querySelector<SVGGElement>('.cell.playing');
  if (playing) highlight(Number(playing.dataset.index));
});

els.exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  els.exportMenu.hidden = !els.exportMenu.hidden;
  els.exportBtn.setAttribute('aria-expanded', String(!els.exportMenu.hidden));
});
els.exportMenu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-export]');
  if (!b) return;
  els.exportMenu.hidden = true;
  void doExport(b.dataset.export!);
});
document.addEventListener('click', () => {
  els.exportMenu.hidden = true;
  els.exportBtn.setAttribute('aria-expanded', 'false');
});

for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab as Settings['tab'];
    syncControls();
    renderChart();
    renderLibrary();
    saveSettings();
  });
}

let lastWidth = 0;
new ResizeObserver(
  debounce(() => {
    const w = els.music.clientWidth || els.chart.clientWidth;
    if (Math.abs(w - lastWidth) < 4) return;
    lastWidth = w;
    renderSheet();
    renderChart();
  }, 120),
).observe(document.querySelector('.content')!);

// Init
els.editor.value = state.text;
syncControls();
update();
renderLibrary();

// Expose a small API for automation (e.g. an agent driving the page, or a native Android shell).
Object.assign(window, {
  ocarinaTabs: {
    loadText: (text: string, mode: 'text' | 'abc' = 'text') => {
      state.editorMode = mode;
      els.editor.value = text;
      state.text = text;
      source = null;
      syncControls();
      update();
    },
    set: (patch: Partial<Settings>) => {
      Object.assign(state, patch);
      syncControls();
      update();
    },
    get arrangement() {
      return current?.arr;
    },
    get library() {
      return library;
    },
    saveToLibrary: () => saveToLibrary(),
    openFromLibrary,
  },
});
