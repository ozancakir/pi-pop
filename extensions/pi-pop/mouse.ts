// @ts-nocheck
// Terminal input: opens the viewer on the configured shortcut, and routes the
// mouse wheel to the open viewer.

import { matchesKey } from "@earendil-works/pi-tui";
import { SGR_MOUSE_RE, config, state } from "./shared.ts";

export function attach(tui) {
  state.activeTui = tui;
  tui.addInputListener((data) => {
    // Open the viewer on any configured shortcut (default Shift+Alt+Arrow, set by
    // `keys` in ~/.pi/pi-pop.json — any of pi's key specs, e.g. "ctrl+p").
    if (!tui.hasOverlay?.() && config.keys.some((k) => matchesKey(data, k))) {
      state.openViewer?.();
      return { consume: true };
    }
    // While the viewer is open it enables mouse reporting; route the wheel to it
    // (button 64 = up, 65 = down) and swallow every other mouse report.
    if (state.activeViewer) {
      const m = data.match(SGR_MOUSE_RE);
      if (m) {
        const btn = parseInt(m[1], 10);
        if ((btn & 64) !== 0 && m[4] === "M") {
          state.activeViewer.scrollBy((btn & 1) === 1 ? 3 : -3);
        }
        return { consume: true };
      }
    }
    return undefined;
  });
}
