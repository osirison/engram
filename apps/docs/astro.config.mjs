// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Engram developer documentation (WP6).
//
// Deployed as a merged artifact under `/docs` on the marketing-site GitHub
// Pages deploy (Strategy A). The `base` below must match the subpath so that
// sidebar links and the Pagefind search index resolve under `/docs/`.
//
// TypeDoc API reference (T5) is layered in via starlight-typedoc; see the
// commented block below — it is enabled once the packages typecheck cleanly
// under the docs build. https://astro.build/config
export default defineConfig({
  site: 'https://engram.events',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Engram Docs',
      description:
        'Developer documentation for Engram — an MCP memory server for AI agents.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/qp/engram',
        },
      ],
      // starlight-links-validator fails the Astro build on broken internal
      // links — the standing gate for `.mdx`/`.md` content that `pnpm
      // docs:check` does not cover. TypeDoc-generated API pages are excluded
      // because the plugin emits deep cross-links the validator over-reports.
      plugins: [
        starlightLinksValidator({
          exclude: ['/docs/reference/api/**'],
        }),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Overview', slug: 'reference' },
            { label: 'Configuration', slug: 'reference/configuration' },
          ],
        },
      ],
    }),
  ],
});
