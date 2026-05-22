---
title: ENGRAM ESLint Config Package
description: Shared ESLint presets for ENGRAM workspaces
---

## Overview

`@repo/eslint-config` contains the shared ESLint presets used by the web, docs,
and package workspaces.

## Exports

| Export                               | Purpose                      |
| ------------------------------------ | ---------------------------- |
| `@repo/eslint-config/base`           | Base TypeScript rules        |
| `@repo/eslint-config/next-js`        | Next.js application rules    |
| `@repo/eslint-config/react-internal` | Internal React package rules |

## Usage

Import the preset from a workspace `eslint.config.js` or `eslint.config.mjs`.

```javascript
import baseConfig from '@repo/eslint-config/base';

export default [...baseConfig];
```
