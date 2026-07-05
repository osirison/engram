import type { HelmetOptions } from 'helmet';

/**
 * Helmet configuration for the MCP server (#206).
 *
 * This process speaks JSON-RPC over HTTP and serves plaintext health/metrics —
 * it never returns HTML with subresources. So instead of disabling the CSP
 * (the prior `contentSecurityPolicy: false`), lock it down: deny every resource
 * type and forbid the page being framed or navigating forms/base URIs. A
 * response body is JSON either way, so a browser that somehow renders one is
 * permitted to load nothing. If an HTML surface is ever added, relax the
 * specific directives it needs rather than turning the policy off wholesale.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
};
