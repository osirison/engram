---
title: Engram marketing site
description: Vite + React marketing site for ENGRAM, deployed to engram.events via GitHub Pages
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

The site is a Vite + React 18 app. It needs a build step — serving the source
folder directly will not work (`app.jsx` is raw JSX that browsers cannot
execute).

```bash
cd apps/marketing-site
npm ci           # install from package-lock.json (npm, not pnpm)
npm run dev      # Vite dev server with hot reload
```

Production build and local preview:

```bash
npm run build    # emits dist/
npm run preview  # serve the built dist/ locally
```

Lint with `npm run lint` (self-contained ESLint flat config).

## Workspace note

This app is intentionally **excluded from the pnpm workspace**
(`pnpm-workspace.yaml` lists `!apps/marketing-site`) and manages its own
dependencies with npm via its own `package-lock.json`. Root `pnpm`/Turborepo
commands do not build it — `pnpm --filter @engram/marketing-site <cmd>` matches
no project by design.

CI lint/build/deploy live in `.github/workflows/node.js.yml` (npm-based,
path-filtered). On pushes to `main` the built `dist/` is deployed to GitHub
Pages at [https://engram.events](https://engram.events) (custom domain shipped
via `public/CNAME`; DNS/TLS runbook: `docs/MARKETING_SITE_DOMAIN.md`).
