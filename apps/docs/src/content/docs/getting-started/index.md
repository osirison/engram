---
title: Getting started
description: Overview of Engram deployment profiles and where to go next.
---

Engram ships three deployment profiles. Pick the one that matches how much
infrastructure you want to run, then follow the matching guide.

| Profile        | Storage                         | External services       | Use it for                               |
| -------------- | ------------------------------- | ----------------------- | ---------------------------------------- |
| **memory**     | In-process (ephemeral)          | None                    | Trying Engram out; zero-dependency demos |
| **lite**       | Local JSON + pgvector           | Postgres                | Single-host, low-ops deployments         |
| **enterprise** | Postgres + Redis + vector store | Postgres, Redis, Qdrant | Production, multi-tenant workloads       |

The full getting-started tutorials (quick start, installation, first memory, and
MCP client setup) are being migrated into this site. In the meantime, the
authoritative setup instructions live in
[`docs/SETUP.md`](https://github.com/qp/engram/blob/main/docs/SETUP.md) in the
repository.
