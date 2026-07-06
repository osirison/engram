---
description: Rules for editing TypeScript sources in this project.
name: typescript-sources
applyTo: src/**/*.ts
---

Keep TypeScript strict: no unjustified `any`, guard array access under
`noUncheckedIndexedAccess`, and validate boundaries with Zod. For the broader
conventions see [the contributor guide](../../docs/guide.md).
