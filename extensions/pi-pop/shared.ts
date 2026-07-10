// @ts-nocheck
// Shared constants, caches, and cross-module mutable state for pi-pop.

/** Mouse reporting enabled while the viewer overlay is open so the wheel scrolls
 *  it. Uses X10 (`?9h` press-only, `?1006h` SGR) rather than `?1000h`, which made
 *  some terminals snap the viewport to the bottom on enable. */
export const OVERLAY_MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
/** Reset every mouse mode we may have touched; harmless when not set. */
export const MOUSE_OFF = "\x1b[?9l\x1b[?1000l\x1b[?1006l";
export const SWEEP_MS = 300;

/** SGR mouse report: ESC [ < btn ; col ; row (M=press, m=release) */
export const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export const COLLAPSED = "▶";
export const EXPANDED = "▼";
/** pi-pop brand glyph, shown on config notifications. */
export const POP_ICON = "▣";

/** Fallback expanded-state tracker for components that store no state. */
export const expandedState = new WeakMap();
/** Components that currently render a marker (i.e. hide content). */
export const markable = new WeakSet();
/** Per-component title cache used by config matching. */
export const titleCache = new WeakMap();
/** Per-component probe cache (probeHasMore). */
export const hasMoreCache = new WeakMap();

/**
 * User config, persisted by config.ts:
 * - `include`/`exclude`: which panels the viewer lists (patterns on the title).
 * - `keys`: the shortcut(s) that open the viewer, matched with `matchesKey`
 *   (any of pi's key specs, e.g. "ctrl+p", "alt+space"). Defaults to the four
 *   Shift+Alt+Arrow combos.
 */
export const DEFAULT_KEYS = ["shift+alt+up", "shift+alt+down", "shift+alt+left", "shift+alt+right"];
export const config = { include: [], exclude: [], keys: [...DEFAULT_KEYS] };

/**
 * Cross-module mutable refs. A single object (shared reference) so any module can
 * read/update these without live-binding gymnastics.
 * - `openViewer(target?)`: opens the overlay; set on session_start.
 * - `activeViewer`: the open Viewer instance, or null (for wheel routing).
 * - `activeTui`: live TUI captured on attach (so config changes can re-render).
 * - `viewerOpen`: guard so the overlay can't open twice.
 */
export const state = {
  openViewer: null,
  activeViewer: null,
  activeTui: null,
  viewerOpen: false,
};
