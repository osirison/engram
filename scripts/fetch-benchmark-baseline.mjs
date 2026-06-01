#!/usr/bin/env node

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    branch: 'main',
    workflow: 'ci.yml',
    artifactPrefix: 'vector-backend-benchmark-',
    out: 'artifacts/bench-baseline.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--branch':
        args.branch = value ?? args.branch;
        i += 1;
        break;
      case '--workflow':
        args.workflow = value ?? args.workflow;
        i += 1;
        break;
      case '--artifact-prefix':
        args.artifactPrefix = value ?? args.artifactPrefix;
        i += 1;
        break;
      case '--out':
      case '-o':
        args.out = value ?? args.out;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

async function api(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'engram-benchmark-baseline-fetcher',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

async function main() {
  const { branch, workflow, artifactPrefix, out } = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token || !repository) {
    console.log('Skipping baseline fetch: missing GITHUB_TOKEN/GH_TOKEN or GITHUB_REPOSITORY');
    return;
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    console.log('Skipping baseline fetch: invalid GITHUB_REPOSITORY format');
    return;
  }

  const runsUrl =
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs` +
    `?branch=${encodeURIComponent(branch)}&status=completed&per_page=20`;

  const runsResp = await api(runsUrl, token);
  const runsJson = await runsResp.json();
  const successfulRuns = (runsJson.workflow_runs ?? []).filter(
    (run) => run.conclusion === 'success',
  );

  for (const run of successfulRuns) {
    const artifactsUrl =
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts`;
    const artifactsResp = await api(artifactsUrl, token);
    const artifactsJson = await artifactsResp.json();
    const artifact = (artifactsJson.artifacts ?? []).find(
      (entry) =>
        !entry.expired &&
        typeof entry.name === 'string' &&
        entry.name.startsWith(artifactPrefix),
    );

    if (!artifact) {
      continue;
    }

    const zipResp = await api(artifact.archive_download_url, token);
    const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
    const zipPath = join(tmpdir(), `bench-baseline-${artifact.id}.zip`);
    await writeFile(zipPath, zipBuffer);

    const jsonText = execFileSync('unzip', ['-p', zipPath], {
      encoding: 'utf8',
    });

    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, jsonText, 'utf8');
    console.log(`Fetched benchmark baseline from run ${run.id} into ${out}`);
    return;
  }

  console.log('No successful baseline artifact found on main branch; continuing without trend baseline');
}

main().catch((error) => {
  console.log(`Baseline fetch skipped: ${error instanceof Error ? error.message : String(error)}`);
});
