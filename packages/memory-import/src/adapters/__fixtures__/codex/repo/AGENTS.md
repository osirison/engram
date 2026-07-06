---
title: Example Repo Agent Instructions
description: Top-level guidance for agents working in this repository.
---

This preamble introduces the repository-wide conventions that every agent must
follow. It is intentionally long enough to survive fragment folding so that the
overview section becomes its own imported fact rather than being merged into the
first heading below.

## Build And Test

Run the standard build before opening a pull request. See [README.md](README.md)
for the full contributor checklist and environment bootstrap steps. Keep this
section comfortably above the minimum-section threshold so it is emitted as its
own addressable chunk with a stable anchor derived from the heading text.

## Coding Style

Prefer small, well-named functions and exhaustive tests. Reference the shared
[docs/style.md](docs/style.md) guide when in doubt about formatting decisions.
This paragraph pads the section past the minimum-section threshold so the split
chunk mode yields a distinct fact for coding style guidance in the IR output.
