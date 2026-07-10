// @ts-nocheck
// Panel discovery, content extraction, and the in-conversation ▶/▼ markers.

import { visibleWidth } from "@earendil-works/pi-tui";
import {
  COLLAPSED,
  EXPANDED,
  SWEEP_MS,
  expandedState,
  markable,
  titleCache,
  hasMoreCache,
  config,
} from "./shared.ts";

export function isExpandable(component) {
  return (
    typeof component === "object" &&
    component !== null &&
    typeof component.setExpanded === "function"
  );
}

export function currentExpanded(component) {
  if (typeof component.expanded === "boolean") return component.expanded;
  if (typeof component._expanded === "boolean") return component._expanded;
  return expandedState.get(component) ?? false;
}

export function patternMatches(pattern, text) {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function anyMatch(patterns, text) {
  return patterns.some((p) => patternMatches(p, text));
}

/** Title = first non-blank line of already-rendered lines, minus SGR and marker. */
export function titleOfLines(lines) {
  if (!Array.isArray(lines)) return "";
  for (const l of lines) {
    if (typeof l !== "string") continue;
    const plain = l.replace(/\x1b\[[0-9;]*m/g, "").replace(/^[\s▶▼]+/, "").trim();
    if (plain) return plain;
  }
  return "";
}

/**
 * Read a panel's *expanded* content without mutating the conversation. The panel
 * is temporarily expanded, rendered (undecorated), and restored — synchronously,
 * so the base frame never changes and the viewport never snaps. Same trick as
 * probeHasMore; toggling the real panel is deliberately avoided everywhere.
 */
export function panelContent(panel, width) {
  const render = panel.__piPopRender || panel.render.bind(panel);
  const was = currentExpanded(panel);
  let lines;
  try {
    panel.setExpanded(true);
    lines = render(width);
  } finally {
    panel.setExpanded(was);
  }
  return Array.isArray(lines) ? lines.filter((l) => typeof l === "string") : [];
}

/** Collect every expandable component in render (top-to-bottom) order. */
export function collectExpandables(node, out) {
  if (isExpandable(node)) out.push(node);
  const children = node?.children;
  if (Array.isArray(children)) {
    for (const child of children) collectExpandables(child, out);
  }
  return out;
}

/** First non-blank rendered line of a panel, stripped of SGR and our marker. */
export function panelTitle(component, width) {
  let lines;
  try {
    lines = component.render(width);
  } catch {
    return "(panel)";
  }
  return titleOfLines(lines) || "(panel)";
}

function cachedTitleFor(component, width) {
  let t = titleCache.get(component);
  if (t === undefined) {
    t = panelTitle(component, width);
    titleCache.set(component, t);
  }
  return t;
}

/**
 * Panels the viewer lists. Default: those showing a marker (hidden content). The
 * user's config widens/narrows this: `include` adds title-matching panels even
 * without hidden content; `exclude` drops title-matching panels.
 */
export function navigableExpandables(tui) {
  const all = collectExpandables(tui, []);
  if (config.include.length === 0 && config.exclude.length === 0) {
    return all.filter((c) => markable.has(c));
  }
  const width = tui.terminal.columns;
  return all.filter((c) => {
    const t = cachedTitleFor(c, width);
    return (markable.has(c) || anyMatch(config.include, t)) && !anyMatch(config.exclude, t);
  });
}

/** Newest (bottom-most) expandable whose title matches `pattern`, or null. */
export function findNewestPanel(tui, pattern) {
  const width = tui.terminal.columns;
  let found = null;
  for (const c of collectExpandables(tui, [])) {
    if (patternMatches(pattern, cachedTitleFor(c, width))) found = c; // keep last
  }
  return found;
}

/**
 * A marker is only warranted when expanding actually reveals something. Probe:
 * render the opposite expanded state and diff it; memoized per component on a
 * cheap fingerprint (state, width, line count, joined length).
 */
export function probeHasMore(component, originalRender, width, currentLines) {
  const fingerprint = `${currentExpanded(component)}|${width}|${currentLines.length}|${currentLines.join("\n").length}`;
  const cached = hasMoreCache.get(component);
  if (cached && cached.fingerprint === fingerprint) return cached.hasMore;
  const current = currentExpanded(component);
  let other;
  try {
    component.setExpanded(!current);
    other = originalRender(width);
  } finally {
    component.setExpanded(current);
  }
  let hasMore = false;
  if (Array.isArray(other)) {
    if (other.length !== currentLines.length) {
      hasMore = true;
    } else {
      for (let i = 0; i < other.length; i++) {
        if (other[i] !== currentLines[i]) {
          hasMore = true;
          break;
        }
      }
    }
  }
  hasMoreCache.set(component, { fingerprint, hasMore });
  return hasMore;
}

export function decorateExpandable(component, theme) {
  if (component.__piPopDecorated) return false;
  component.__piPopDecorated = true;
  // Keep our expanded-state fallback in sync with *every* caller of setExpanded
  // (viewer probes, clicks, global ctrl+o, session rebuilds).
  const originalSetExpanded = component.setExpanded.bind(component);
  component.setExpanded = (value) => {
    expandedState.set(component, value === true);
    return originalSetExpanded(value);
  };
  const originalRender = component.render.bind(component);
  component.__piPopRender = originalRender; // used by the content viewer
  component.render = (width) => {
    const lines = originalRender(width);
    if (!Array.isArray(lines) || lines.length === 0) return lines;
    const hasMore = probeHasMore(component, originalRender, width, lines);
    if (hasMore) markable.add(component);
    else markable.delete(component);
    // Hidden by config: drop the marker (still viewable, just not flagged).
    if (config.exclude.length && anyMatch(config.exclude, titleOfLines(lines))) {
      return lines;
    }
    if (!hasMore) return lines;
    // Put the marker in a left gutter and shift content right at constant width;
    // reuse the line's own background so no default-bg gap shows.
    const marker = currentExpanded(component) ? EXPANDED : COLLAPSED;
    const gutter = visibleWidth(marker) + 1; // marker + one space
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const line = lines[i];
      if (typeof line !== "string") return lines;
      const base = line.replace(/ +((?:\x1b\[[0-9;]*m)*)$/, "$1");
      const used = visibleWidth(base);
      if (used === 0) continue; // blank padding row
      const rightPad = width - gutter - used;
      if (rightPad < 0) continue; // no room for a left gutter
      const bg = (line.match(/\x1b\[48;[0-9;]*m/) || [""])[0];
      const decorated = [...lines];
      decorated[i] =
        bg + theme.fg("dim", marker) + bg + " " + base + bg + " ".repeat(rightPad);
      return decorated;
    }
    return lines;
  };
  return true;
}

function sweepExpandables(node, theme) {
  let changed = false;
  if (isExpandable(node)) {
    changed = decorateExpandable(node, theme) || changed;
  }
  const children = node?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      changed = sweepExpandables(child, theme) || changed;
    }
  }
  return changed;
}

export function improvePanelAppearance(tui, theme) {
  const sweep = setInterval(() => {
    if (tui.stopped) return;
    if (sweepExpandables(tui, theme)) {
      tui.requestRender();
    }
  }, SWEEP_MS);
  sweep.unref?.();
}
