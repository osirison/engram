// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

// Engram developer documentation (WP6).
//
// Deployed as a merged artifact under `/docs` on the marketing-site GitHub
// Pages deploy (Strategy A). The `base` below must match the subpath so that
// sidebar links and the Pagefind search index resolve under `/docs/`.
// https://astro.build/config

// TypeDoc API reference (T5). starlight-typedoc runs TypeDoc at build time and
// writes per-package Markdown into `src/content/docs/reference/api/` (git-ignored;
// always regenerated from source, so it cannot drift). `typeDocSidebarGroup`
// carries the generated nav tree into the sidebar.
const [starlightTypeDoc, typeDocSidebarGroup] = createStarlightTypeDocPlugin();

const packages = [
  'config',
  'core',
  'memory-stm',
  'memory-ltm',
  'memory-lite',
  'embeddings',
  'vector-store',
  'database',
  'redis',
  'auth',
  'eval',
  'client',
];

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
          href: 'https://github.com/osirison/engram',
        },
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints: packages.map((p) => `../../packages/${p}`),
          tsconfig: '../../tsconfig.json',
          output: 'reference/api',
          typeDoc: {
            entryPointStrategy: 'packages',
            excludePrivate: true,
            excludeInternal: true,
            // Cross-package type resolution can trip TypeDoc without a full
            // build; skip its type checking (it only reads declarations).
            skipErrorChecking: true,
            gitRevision: 'main',
          },
        }),
        // starlight-links-validator fails the Astro build on broken internal
        // links — the standing gate for `.mdx`/`.md` content that `pnpm
        // docs:check` does not cover.
        starlightLinksValidator({
          // Generated reference pages cross-link with relative paths (e.g.
          // `./recall`) so they also resolve under `pnpm docs:check`, which
          // resolves links against the filesystem. Validate them as routes
          // rather than rejecting relative links outright.
          errorOnRelativeLinks: false,
          // Setup guides and TypeDoc examples legitimately reference local dev
          // URLs (e.g. http://localhost:3000); don't treat those as broken.
          errorOnLocalLinks: false,
          // TypeDoc emits deep cross-links the validator over-reports on; the
          // API pages are validated by TypeDoc itself.
          exclude: ['/docs/reference/api/**'],
        }),
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Architecture',
          collapsed: true,
          items: [{ autogenerate: { directory: 'architecture' } }],
        },
        {
          label: 'How-to guides',
          collapsed: true,
          items: [{ autogenerate: { directory: 'how-to' } }],
        },
        {
          label: 'Agent memory',
          collapsed: true,
          items: [{ autogenerate: { directory: 'agent-memory' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Overview', slug: 'reference' },
            {
              label: 'MCP Tools',
              items: [{ autogenerate: { directory: 'reference/mcp-tools' } }],
            },
            { label: 'Configuration', slug: 'reference/configuration' },
            {
              label: 'Configuration guide',
              slug: 'reference/configuration-guide',
            },
            { label: 'Capacity & scaling', slug: 'reference/capacity' },
            { label: 'Concurrency policy', slug: 'reference/concurrency-policy' },
            { label: 'Observability', slug: 'reference/observability' },
            { label: 'Release gates', slug: 'reference/release-gates' },
            {
              label: 'Security',
              items: [
                { label: 'OWASP checklist', slug: 'reference/security' },
                {
                  label: 'Review 2026-07-02',
                  slug: 'reference/security-reviews/2026-07-02',
                },
              ],
            },
            typeDocSidebarGroup,
          ],
        },
        {
          label: 'Contributing',
          collapsed: true,
          items: [{ autogenerate: { directory: 'contributing' } }],
        },
      ],
    }),
  ],
});
