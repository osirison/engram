---
title: Repo Copilot Instructions
description: Repo-wide guidance for GitHub Copilot in this synthetic project.
---

This preamble describes how Copilot should behave across the whole repository.
It is intentionally long enough to survive the fragment fold and become its own
`overview` section rather than being merged into the first heading below. See
[AGENTS.md](../AGENTS.md) and [README.md](../README.md) for the canonical rules.

## Build

Always run the build before committing. Prefer the workspace scripts over ad-hoc
commands, and never bypass verification hooks. This section is padded with enough
prose to comfortably exceed the minimum section length so it is not folded into
the next section during chunking, keeping it independently addressable.

## Testing

Every feature needs tests at both the service and wiring levels. Keep fixtures
synthetic and deterministic. This section is likewise padded with sufficient
explanatory text so that the heading-based chunker treats it as a standalone
section with its own stable anchor and source key.
