---
title: ENGRAM Production Deployment Guide
description: How to build and run the hardened production Docker image
---

This page has moved. See
[Deploy to production — ENGRAM Developer Docs](https://engram.events/docs/how-to/deploy-production/).

Quick facts (pinned here for cross-file contract tests):

- Releases are published by `.github/workflows/release.yml` on `v*` tags; CI
  builds are validation-only and never push.
- The published image is `ghcr.io/osirison/engram/mcp-server`, the image
  `docker-compose.prod.yml` pulls.
- Pin a version in production by setting `IMAGE_TAG` in `.env.prod` instead of
  relying on `latest`.
