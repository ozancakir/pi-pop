// @ts-nocheck
// Persisted config for which panels the viewer lists, edited by conversation via
// the pi-pop-config tool (see index.ts).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config, state, DEFAULT_KEYS } from "./shared.ts";

export const CONFIG_PATH = path.join(os.homedir(), ".pi", "pi-pop.json");

export function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    config.include = Array.isArray(raw.include) ? raw.include : [];
    config.exclude = Array.isArray(raw.exclude) ? raw.exclude : [];
    config.keys =
      Array.isArray(raw.keys) && raw.keys.length ? raw.keys : [...DEFAULT_KEYS];
  } catch {
    // no config yet — defaults stand
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    // best-effort; config still applies in-memory this session
  }
}

/** Apply a config action and return a short one-line result. */
export function applyPopConfig(action, pattern) {
  const p = (pattern || "").trim();
  const needsPattern = action === "show" || action === "hide" || action === "remove";
  if (needsPattern && !p) return `"${action}" needs a pattern`;
  switch (action) {
    case "show":
      if (!config.include.includes(p)) config.include.push(p);
      break;
    case "hide":
      if (!config.exclude.includes(p)) config.exclude.push(p);
      break;
    case "remove":
      config.include = config.include.filter((x) => x !== p);
      config.exclude = config.exclude.filter((x) => x !== p);
      break;
    case "reset":
      config.include = [];
      config.exclude = [];
      break;
    case "list":
      return `panels — show: ${config.include.join(", ") || "none"} · hide: ${config.exclude.join(", ") || "none"}`;
    default:
      return `unknown action "${action}" (use show, hide, remove, list, reset)`;
  }
  saveConfig();
  state.activeTui?.requestRender?.();
  if (action === "show") return `${p} added to panels`;
  if (action === "hide") return `${p} removed from panels`;
  if (action === "remove") return `${p} rule removed`;
  return "panel rules reset";
}
