// ESLint flat config for the marketing site.
//
// This app is intentionally excluded from the pnpm workspace (see
// pnpm-workspace.yaml), so it carries its own minimal lint setup. CI runs
// `npm run lint` in the `verify` job of .github/workflows/node.js.yml before
// anything is deployed to GitHub Pages.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      // JSX identifiers count as usage (core no-unused-vars ignores JSX).
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node-side config files (not shipped to the browser).
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
