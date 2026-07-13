/* main.jsx — browser entry.
 * The build prerenders <App/> into #root (see prerender.mjs), so production
 * hydrates the existing markup; in dev, index.html ships an empty #root and
 * we fall back to a plain client render. smooth-scroll.js runs at import time
 * (matchMedia + wheel listeners), so it lives here, out of the SSR path. */
import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './app.jsx';
import './smooth-scroll.js';

const rootEl = document.getElementById('root');
if (rootEl.hasChildNodes()) {
  hydrateRoot(rootEl, <App />);
} else {
  createRoot(rootEl).render(<App />);
}
