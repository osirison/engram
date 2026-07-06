# Project Guide

This is the project overview preamble. It intentionally carries enough prose to
survive the fragment fold so that it becomes its own `overview` section instead
of being merged forward into the first heading. Keep reading below for commands
and architecture notes that each stand alone as their own imported chunk.

## Commands

All commands run from the repository root. Run `pnpm build`, then `pnpm test`,
and consult [AGENTS.md](AGENTS.md) for the contributor workflow. This section is
deliberately long enough to exceed the minimum section size so the chunker keeps
it as a distinct fact rather than folding it into a neighbour.

## Architecture

The system is a TypeScript monorepo with a NestJS runtime backed by PostgreSQL,
Redis, and Qdrant. This architecture section is written with plenty of
descriptive content so it comfortably exceeds the fragment-fold threshold and is
emitted as its own individually addressable instruction chunk.
