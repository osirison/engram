---
title: ENGRAM
description: Developer setup and project entry points for the ENGRAM MCP memory server
---

# Engram marketing site

A radically minimal marketing site for Engram (agent memory / MCP server).

The hero is one serif line plus a single input: type a memory and watch it
resolve into the field. The background is a "dream-walk through memory" — real
agent-memory fragments suspended at varying depths, mostly blurred and
peripheral. The cursor acts as a lantern that wipes the fog locally, snapping
nearby fragments into focus with connecting lines. On load (and after the
cursor goes idle) the lantern auto-drifts along a rose curve that sweeps across
a slowly cycling sacred-geometry backdrop.

## Files

| File               | Role                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`       | Shell, styles, and copy. Entry point.                                                                                                                                       |
| `app.jsx`          | React app: hero input, memory panels, the four verbs, install section, and the Tweaks panel.                                                                                |
| `memory-haze.js`   | The depth-of-field engine: fragment field, lantern, idle drift, and the sacred-geometry backdrop (Flower of Life, Metatron's Cube, Sri Yantra, Hexagram, Pentagram, Torus). |
| `smooth-scroll.js` | Eased momentum scrolling that keeps the real scroll position authoritative.                                                                                                 |
| `tweaks-panel.jsx` | In-page Tweaks panel (haze, lantern, float, geometry shape, idle drift).                                                                                                    |

## Running

It is a static site with no build step. Serve the folder over any static
host, e.g.:

```bash
npx serve apps/marketing-site
```

Then open the printed URL. React, ReactDOM, and Babel are loaded from a CDN
(pinned versions) directly in `index.html`.
