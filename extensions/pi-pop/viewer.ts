// @ts-nocheck
// The floating overlay that reads a panel's content (never toggles it).

import { visibleWidth, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { OVERLAY_MOUSE_ON, MOUSE_OFF, state } from "./shared.ts";
import { navigableExpandables, panelTitle, panelContent } from "./panels.ts";

/**
 * Floating overlay that shows an expandable panel's *content* — a reader, not a
 * toggle. Left/Right switch panel, Up/Down and Shift+Up/Down (or PageUp/Down) or
 * the mouse wheel scroll, Esc closes. Rendered via ctx.ui.custom({ overlay: true })
 * on top of the conversation without a screen-clearing redraw, and it never calls
 * setExpanded on the real panel, so the viewport never snaps.
 */
class Viewer {
  constructor(tui, theme, done, target) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.width = tui.terminal.columns;
    this.titleCache = new WeakMap();
    // A tool/command can target a specific panel that the config wouldn't list;
    // pin it so it stays selectable across sync() rebuilds.
    this.pinned = target || null;
    this.panels = navigableExpandables(tui);
    if (this.pinned && !this.panels.includes(this.pinned)) this.panels.push(this.pinned);
    this.titles = this.panels.map((p) => this.cachedTitle(p));
    const idx = target ? this.panels.indexOf(target) : -1;
    this.sel = idx >= 0 ? idx : Math.max(0, this.panels.length - 1); // newest/bottom
    this.scroll = 0;
    // Fill most of the terminal height (header + footer + borders take ~4 rows).
    this.bodyRows = Math.max(6, Math.floor((tui.terminal.rows || 40) * 0.85) - 4);
    this.contentLen = 0;
    state.activeViewer = this;
    tui.terminal.write(OVERLAY_MOUSE_ON); // enable wheel scroll while open
  }

  cachedTitle(panel) {
    let t = this.titleCache.get(panel);
    if (t === undefined) {
      t = panelTitle(panel, this.width);
      this.titleCache.set(panel, t);
    }
    return t;
  }

  /**
   * Re-read the panel list so panels that appear while the overlay is open show
   * up. The current selection is preserved by *reference* (not index), so a new
   * panel arriving below never yanks the view — you keep reading, and reach it
   * with Right when you want.
   */
  sync() {
    const current = this.panels[this.sel] || null;
    this.panels = navigableExpandables(this.tui);
    if (this.pinned && !this.panels.includes(this.pinned)) this.panels.push(this.pinned);
    this.titles = this.panels.map((p) => this.cachedTitle(p));
    let idx = current ? this.panels.indexOf(current) : -1;
    if (idx < 0) idx = Math.min(this.sel, this.panels.length - 1);
    this.sel = Math.max(0, idx);
  }

  handleInput(data) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }
    this.sync();
    if (!this.panels.length) return;
    if (matchesKey(data, "left")) this.select(-1);
    else if (matchesKey(data, "right")) this.select(1);
    else if (matchesKey(data, "up")) this.scrollBy(-1);
    else if (matchesKey(data, "down")) this.scrollBy(1);
    else if (matchesKey(data, "shift+up") || matchesKey(data, "pageup"))
      this.scrollBy(-this.bodyRows);
    else if (matchesKey(data, "shift+down") || matchesKey(data, "pagedown"))
      this.scrollBy(this.bodyRows);
    else if (matchesKey(data, "home")) this.scrollTo(0);
    else if (matchesKey(data, "end")) this.scrollTo(Infinity);
  }

  select(dir) {
    this.sel = (this.sel + dir + this.panels.length) % this.panels.length;
    this.scroll = 0;
    this.tui.requestRender();
  }

  scrollBy(n) {
    this.scrollTo(this.scroll + n);
  }

  scrollTo(n) {
    const max = Math.max(0, this.contentLen - this.bodyRows);
    this.scroll = Math.max(0, Math.min(max, n));
    this.tui.requestRender();
  }

  render(width) {
    this.sync(); // pick up panels that appeared while the overlay is open
    const th = this.theme;
    const innerW = Math.max(10, width - 2);
    const border = (c) => th.fg("border", c);
    const row = (s) => border("│") + truncateToWidth(s, innerW, "…", true) + border("│");

    const out = [];
    const pos = this.panels.length ? `${this.sel + 1}/${this.panels.length}` : "0/0";
    const title = this.panels.length ? this.titles[this.sel] : "no expandable panels";
    const head = ` ${pos}  ${title} `;
    const dash = Math.max(0, innerW - visibleWidth(head));
    out.push(border("╭") + th.fg("accent", head) + border("─".repeat(dash) + "╮"));

    // Render the panel at its natural (terminal) width, then wrap each line to
    // the box width so content wider than the box flows onto the next row
    // instead of being cut off the right edge. (Panels that hard-truncate their
    // own output at a fixed width can't be recovered — the text isn't rendered.)
    const raw = this.panels.length ? panelContent(this.panels[this.sel], this.width) : [];
    const content = [];
    for (const line of raw) {
      const trimmed = line.replace(/\s+((?:\x1b\[[0-9;]*m)*)$/, "$1"); // drop padding
      const parts = wrapTextWithAnsi(trimmed, innerW - 1);
      if (parts.length === 0) content.push("");
      else for (const part of parts) content.push(part);
    }
    this.contentLen = content.length;
    if (this.scroll > Math.max(0, content.length - this.bodyRows)) {
      this.scroll = Math.max(0, content.length - this.bodyRows);
    }
    const slice = content.slice(this.scroll, this.scroll + this.bodyRows);
    for (const line of slice) out.push(row(" " + line));
    for (let i = slice.length; i < this.bodyRows; i++) out.push(row(""));

    const range =
      content.length > this.bodyRows
        ? `   ${this.scroll + 1}-${Math.min(content.length, this.scroll + this.bodyRows)}/${content.length}`
        : "";
    out.push(
      border("│") +
        th.fg("dim", truncateToWidth(` ←/→ panel   ↑↓/wheel scroll   ⇧ + ↑↓ page   esc close${range}`, innerW, "…", true)) +
        border("│"),
    );
    out.push(border("╰" + "─".repeat(innerW) + "╯"));
    return out;
  }

  invalidate() {}
  dispose() {
    if (state.activeViewer === this) state.activeViewer = null;
    this.tui.terminal.write(MOUSE_OFF); // release wheel capture on close
  }
}

export function launchViewer(ui, target) {
  if (state.viewerOpen || typeof ui?.custom !== "function") return;
  state.viewerOpen = true;
  ui.custom((tui, theme, _kb, done) => new Viewer(tui, theme, done, target), {
    overlay: true,
    overlayOptions: { anchor: "right-center", width: "90%", maxHeight: "90%" },
  }).finally(() => {
    state.viewerOpen = false;
  });
}
