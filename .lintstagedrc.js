/**
 * lint-staged pipeline.
 *
 * All staged TS/TSX/JS/JSX files are linted with the apps/web ESLint
 * config (which extends the shared Next.js config: React, react-hooks,
 * @next/next, etc.). For the dashboard epic the only staged sources
 * live under apps/web/, so the per-app config is the right choice.
 *
 * Excluded from prettier:
 *   - pnpm-lock.yaml: 540KB machine-generated, triggers OOM/SIGKILL
 *   - .env / .env.example / etc.: no parser inferred
 *
 * Concurrent execution is controlled by the husky pre-commit hook
 * (.husky/pre-commit) via the `--concurrent 1` flag, which keeps the
 * config root valid for lint-staged v17 and avoids the OOM/kill
 * issues that come from spawning many concurrent Node processes on
 * a large staged set.
 */
module.exports = {
  '*.{ts,tsx,js,jsx}': [
    'eslint --fix --config apps/web/eslint.config.js',
    'prettier --write',
  ],
  '*.{json,md,yml,yaml}': (filenames) =>
    filenames
      .filter((filename) => {
        const basename = (filename.replace(/\\/g, '/').split('/').pop()) || '';
        return basename !== 'pnpm-lock.yaml';
      })
      .map(() => 'prettier --write'),
};
