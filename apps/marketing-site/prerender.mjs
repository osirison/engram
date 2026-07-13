/* prerender.mjs — post-build prerender (R12).
 *
 * Runs automatically after `vite build` (npm "postbuild" hook), including the
 * CI Pages deploy in .github/workflows/node.js.yml which calls `npm run build`.
 *
 * Approach: app.jsx is raw JSX, so it cannot be imported by Node directly.
 * We bundle entry-server.jsx with Vite's SSR build (same config/plugins as
 * the client build → identical transforms and a statically-false
 * import.meta.env.DEV), import the resulting bundle, renderToString <App/>,
 * and inject the markup into dist/index.html's empty #root. The client entry
 * (main.jsx) hydrates when #root has children and falls back to createRoot in
 * dev, where #root ships empty.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(here, 'dist', 'index.html');
const ssrOutDir = path.join(here, 'dist-ssr');

// 1. Bundle the SSR entry (react/react-dom stay external and resolve from
//    node_modules when the bundle is imported below).
await build({
  configFile: path.join(here, 'vite.config.js'),
  root: here,
  logLevel: 'warn',
  build: {
    ssr: path.join(here, 'entry-server.jsx'),
    outDir: ssrOutDir,
    emptyOutDir: true,
  },
});

try {
  // 2. Render and inject.
  const bundle = pathToFileURL(path.join(ssrOutDir, 'entry-server.js')).href;
  const { render } = await import(bundle);
  const appHtml = render();
  if (!appHtml || appHtml.length < 1000) {
    throw new Error(`prerender produced suspiciously small markup (${appHtml.length} chars)`);
  }
  const marker = '<div id="root"></div>';
  const html = readFileSync(distIndex, 'utf8');
  if (!html.includes(marker)) {
    throw new Error(`marker ${marker} not found in ${distIndex}`);
  }
  writeFileSync(distIndex, html.replace(marker, `<div id="root">${appHtml}</div>`));
  console.log(`[prerender] injected ${appHtml.length} chars of markup into dist/index.html`);
} finally {
  // 3. The SSR bundle is a build-tool artifact, not a deployable asset.
  rmSync(ssrOutDir, { recursive: true, force: true });
}
