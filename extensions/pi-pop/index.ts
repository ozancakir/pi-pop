// pi-pop — pop open a floating viewer to read Pi's collapsible panels.
//
// Viewer (primary, cross-platform): press Shift+Alt+Arrow (or run `/pop`) to open
// a floating overlay that shows an expandable panel's content. Left/Right switch
// panel, Up/Down (or mouse wheel) scroll, Shift+Up/Down page, Esc closes. It reads
// each panel's expanded content by temporarily expanding+rendering+restoring — the
// real panel is never toggled, so nothing re-renders in the conversation.
//
// Why an overlay: pi renders into the normal terminal buffer, so toggling a panel
// (or any off-screen redraw) snaps a scrolled-up viewport to the bottom. The
// overlay draws on top without clearing the screen and never mutates the
// conversation, sidestepping the snap (see .claude/rules for the root cause).
//
// The mouse wheel scrolls the content while the viewer is open.
//
// Markers: every expandable panel gets a dim `▶`/`▼` in a left gutter.
//
// Config: the `pi-pop-config` tool lets the user say "show python3 outputs" /
// "hide grep results" in plain language to change which panels the viewer lists.
//
// Structure: shared.ts (state/constants), panels.ts (discovery + markers),
// viewer.ts (the overlay), mouse.ts (input), config.ts (persisted rules).
//
// @ts-nocheck

import { Type } from "typebox";
import { state, POP_ICON } from "./shared.ts";
import { improvePanelAppearance, findNewestPanel } from "./panels.ts";
import { attach } from "./mouse.ts";
import { launchViewer } from "./viewer.ts";
import { loadConfig, applyPopConfig } from "./config.ts";

export default function (pi) {
  loadConfig();

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.hasUI !== true) return;
    state.openViewer = (target) => launchViewer(ctx.ui, target);
    // Invisible zero-height widget purely to capture the live TUI instance.
    ctx.ui.setWidget("pi-pop", (tui, theme) => {
      attach(tui);
      improvePanelAppearance(tui, theme);
      return { render: () => [] };
    });
  });

  pi.registerCommand("pop", {
    description: "Pop open a floating viewer to read expandable panel content (optional: /pop <pattern> opens the newest matching panel)",
    handler: (args, ctx) => {
      const pat = (args || "").trim();
      const target = pat ? findNewestPanel(state.activeTui, pat) : undefined;
      if (pat && !target) ctx.ui.notify(`${POP_ICON} no panel matching "${pat}"`, "info");
      launchViewer(ctx.ui, target);
    },
  });

  pi.registerCommand("pop-config", {
    description: "Which panels the viewer lists: show|hide|remove|list|reset <pattern>",
    handler: (args, ctx) => {
      const parts = (args || "list").trim().split(/\s+/);
      const action = parts.shift() || "list";
      ctx.ui.notify(`${POP_ICON} ${applyPopConfig(action, parts.join(" "))}`, "info");
    },
  });

  // Open the viewer on a specific panel by name. The user says "show the hypa
  // result" / "show the last grep output" and the agent calls this tool; the
  // viewer opens on the newest matching panel. Programmatic (no keypress), so it
  // never snaps the scroll.
  pi.registerTool({
    name: "pi-pop-show",
    label: "Show panel",
    description:
      "Open the pi-pop floating viewer showing a specific panel's content. " +
      "Give a 'pattern' matched (case-insensitive regex or substring) against " +
      "panel titles (each panel's first line); the newest matching panel opens " +
      "in the viewer. Use when the user asks to see or show a panel's output — " +
      "e.g. 'show the hypa result', 'show the last python3 output'.",
    promptGuidelines: [
      "When the user asks to see or show a specific panel's content — e.g. \"show hypa result\" → {pattern:'hypa'}, \"show the grep output\" → {pattern:'Grep'} — call pi-pop-show. It opens the floating viewer on the newest matching panel. Report the returned summary.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description:
          "Case-insensitive text or regex matched against panel titles (first line). The newest match opens.",
      }),
    }),
    async execute(_id, params) {
      const tui = state.activeTui;
      const target = tui ? findNewestPanel(tui, params.pattern) : null;
      if (!target) {
        return { content: [{ type: "text", text: `No panel matching "${params.pattern}"` }], details: {} };
      }
      state.openViewer?.(target);
      return {
        content: [{ type: "text", text: `Opened the newest panel matching "${params.pattern}" in the viewer` }],
        details: {},
      };
    },
  });

  // Configurable by conversation: the user tells the agent "show python3 outputs
  // in panels" / "stop showing grep results" and the agent calls this tool.
  pi.registerTool({
    name: "pi-pop-config",
    label: "Pop config",
    description:
      "Configure which panels the pi-pop viewer lists. Actions: 'show' <pattern> " +
      "force-shows panels whose first line (title) matches even without hidden " +
      "content; 'hide' <pattern> hides matching panels (and their marker); " +
      "'remove' <pattern> deletes a pattern; 'list' shows current config; 'reset' " +
      "clears it. Patterns are case-insensitive text or regex matched against the " +
      "panel title (e.g. 'python3', '\\\\$ python', 'Grep', 'Read').",
    promptGuidelines: [
      "Use pi-pop-config when the user asks to show or hide certain outputs in the panel viewer — e.g. \"show python3 outputs in panels\" → {action:'show', pattern:'python3'}; \"stop showing grep results\" → {action:'hide', pattern:'Grep'}. Report the returned summary back to the user.",
    ],
    parameters: Type.Object({
      action: Type.String({ description: "One of: show, hide, remove, list, reset" }),
      pattern: Type.Optional(
        Type.String({
          description:
            "Case-insensitive text or regex matched against a panel's first line (title). Required for show/hide/remove.",
        }),
      ),
    }),
    async execute(_id, params) {
      const text = applyPopConfig(params.action, params.pattern);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
