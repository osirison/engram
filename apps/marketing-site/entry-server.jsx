/* entry-server.jsx — build-time prerender entry (R12).
 * Bundled by prerender.mjs via `vite build --ssr` so app.jsx's raw JSX and
 * import.meta.env get the same production transforms as the client bundle.
 * Renders the exact tree main.jsx hydrates; all browser-only work in the app
 * is effect-scoped, so renderToString is safe under Node. */
import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './app.jsx';

export function render() {
  return renderToString(<App />);
}
