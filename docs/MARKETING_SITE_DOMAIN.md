---
title: Marketing Site Domain Runbook
description: DNS and TLS checklist for engram.events on GitHub Pages
---

# Marketing site domain/TLS runbook

This runbook covers DNS and certificate setup for the marketing site hosted on
GitHub Pages at `engram.events`.

## Source of truth in repository

- Deploy workflow: `.github/workflows/node.js.yml`
- Custom domain in workflow: `cname: ${{ env.MARKETING_SITE_DOMAIN }}`, sourced
  from the `MARKETING_SITE_DOMAIN` job env in the `deploy` job (currently
  `engram.events`)
- Build output deployed to Pages: `apps/marketing-site/dist`

## Required GitHub Pages settings

In repository **Settings → Pages**:

1. Set **Custom domain** to `engram.events`.
2. Enable **Enforce HTTPS** (after DNS is correct and cert is issued).

## Required DNS records

Configure DNS at your provider:

### Apex (`engram.events`)

Use one of:

- `A` records to GitHub Pages IPs:
  - `185.199.108.153`
  - `185.199.109.153`
  - `185.199.110.153`
  - `185.199.111.153`
- or provider ALIAS/ANAME flattening to your `<owner>.github.io` Pages host.

### `www` (`www.engram.events`)

- `CNAME` to `<owner>.github.io`
- or provider-level redirect to apex.

Remove conflicting records that point to non-GitHub infrastructure.

## Verification checklist

1. DNS resolves correctly:
   - `dig +short engram.events A`
   - `dig +short www.engram.events CNAME`
2. GitHub Pages is bound to expected custom domain:
   - workflow step **Verify Pages custom domain binding** passes.
3. Certificate includes expected hostname(s):
   - `openssl s_client -servername engram.events -connect engram.events:443 </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
4. Browser checks:
   - `https://engram.events` opens without certificate warnings.
   - `https://www.engram.events` behavior is intentional (redirect or valid host).

## Rollback/contingency

If cert issuance is stuck or browser shows domain mismatch:

1. Temporarily remove custom domain in GitHub Pages settings.
2. Redeploy Pages.
3. Fix DNS records to match GitHub Pages requirements.
4. Re-add `engram.events` as custom domain.
5. Re-enable HTTPS once cert is re-issued.

If your DNS provider uses CDN/proxy SSL modes, switch to DNS-only during cert
issuance and restore proxy mode after certificate validation succeeds.
