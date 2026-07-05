/**
 * Release pipeline contract tests (#201).
 *
 * GitHub Actions workflows cannot execute locally, so these tests pin the
 * *contract* of the tag-driven GHCR release pipeline at two levels:
 *
 *   1. Workflow level — `.github/workflows/release.yml` in isolation:
 *      triggers on `v*` tag pushes, logs into GHCR with the workflow
 *      GITHUB_TOKEN (packages: write), derives semver + sha image tags,
 *      smoke-tests before publishing, pushes with provenance/SBOM
 *      attestations, and attests the pushed digest.
 *
 *   2. Wiring level — cross-file consistency: the image name the release
 *      workflow publishes is exactly the image `docker-compose.prod.yml`
 *      pulls and `docs/deploy.md` documents, the workflow builds the same
 *      Dockerfile the compose fallback build uses, and `ci.yml` stays
 *      build-only (`push: false`) so CI can never publish by accident.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const REPO_ROOT = join(__dirname, '../../../..');
const RELEASE_WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/release.yml');
const CI_WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/ci.yml');
const PROD_COMPOSE_PATH = join(REPO_ROOT, 'docker-compose.prod.yml');
const DEPLOY_DOC_PATH = join(REPO_ROOT, 'docs/deploy.md');

/** The one image reference every producer/consumer must agree on. */
const EXPECTED_IMAGE = 'ghcr.io/osirison/engram/mcp-server';
const EXPECTED_DOCKERFILE = 'apps/mcp-server/Dockerfile';

const stepSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
type WorkflowStep = z.infer<typeof stepSchema>;

const jobSchema = z.object({
  name: z.string().optional(),
  'runs-on': z.string(),
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  steps: z.array(stepSchema),
});
type WorkflowJob = z.infer<typeof jobSchema>;

// The `yaml` package parses YAML 1.2, so the `on:` trigger key stays the
// string "on" instead of collapsing to boolean true (a YAML 1.1 quirk).
const workflowSchema = z.object({
  name: z.string(),
  on: z.unknown(),
  permissions: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  jobs: z.record(z.string(), jobSchema),
});

// `.strict()` at both levels: the release must trigger on *only* a tag
// push (no `workflow_dispatch`, `pull_request`, etc.) carrying *only* a
// `tags` filter — any extra key fails the parse.
const tagTriggerSchema = z
  .object({
    push: z.object({ tags: z.array(z.string()) }).strict(),
  })
  .strict();

const composeSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      image: z.string().optional(),
      build: z
        .object({
          context: z.string(),
          dockerfile: z.string(),
        })
        .optional(),
    }),
  ),
});

function loadYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8')) as unknown;
}

function loadWorkflow(path: string): z.infer<typeof workflowSchema> {
  return workflowSchema.parse(loadYaml(path));
}

function requireJob(
  workflow: z.infer<typeof workflowSchema>,
  jobKey: string,
): WorkflowJob {
  const job = workflow.jobs[jobKey];
  if (!job) {
    throw new Error(`workflow is missing expected job "${jobKey}"`);
  }
  return job;
}

function findStep(
  job: WorkflowJob,
  predicate: (step: WorkflowStep) => boolean,
): WorkflowStep | undefined {
  return job.steps.find(predicate);
}

function usesAction(step: WorkflowStep, action: string): boolean {
  return step.uses !== undefined && step.uses.startsWith(`${action}@`);
}

describe('release workflow (.github/workflows/release.yml)', () => {
  const workflow = loadWorkflow(RELEASE_WORKFLOW_PATH);
  const buildPush = requireJob(workflow, 'build-push');
  const githubRelease = requireJob(workflow, 'github-release');

  it('exists with the expected jobs', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      'build-push',
      'github-release',
    ]);
  });

  it('triggers only on v* tag pushes (no branch or PR triggers)', () => {
    const trigger = tagTriggerSchema.parse(workflow.on);
    // Pin the exact filter: adding another pattern (e.g. `release/*`) must
    // fail this, not silently pass as `toContain` would.
    expect(trigger.push.tags).toEqual(['v*']);
  });

  it('keeps workflow-level permissions read-only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('publishes the image name that production compose pulls', () => {
    expect(workflow.env?.IMAGE_NAME).toBe(EXPECTED_IMAGE);
  });

  describe('build-push job', () => {
    it('elevates exactly the permissions publishing requires', () => {
      expect(buildPush.permissions).toEqual({
        contents: 'read',
        packages: 'write',
        'id-token': 'write',
        attestations: 'write',
      });
    });

    it('logs into GHCR with the workflow GITHUB_TOKEN (no REGISTRY_TOKEN)', () => {
      const login = findStep(buildPush, (step) =>
        usesAction(step, 'docker/login-action'),
      );
      expect(login).toBeDefined();
      expect(login?.with?.registry).toBe('ghcr.io');
      expect(login?.with?.password).toBe('${{ secrets.GITHUB_TOKEN }}');
    });

    it('derives semver + sha tags from the git tag via metadata-action', () => {
      const meta = findStep(buildPush, (step) =>
        usesAction(step, 'docker/metadata-action'),
      );
      expect(meta).toBeDefined();
      expect(meta?.id).toBe('meta');
      expect(meta?.with?.images).toBe('${{ env.IMAGE_NAME }}');

      const tags = z.string().parse(meta?.with?.tags);
      expect(tags).toContain('type=semver,pattern={{version}}');
      expect(tags).toContain('type=semver,pattern={{major}}.{{minor}}');
      expect(tags).toContain('type=semver,pattern={{major}}');
      expect(tags).toContain('type=sha,format=long');
    });

    it('smoke-tests a load-only build before anything is pushed', () => {
      const loadIndex = buildPush.steps.findIndex(
        (step) =>
          usesAction(step, 'docker/build-push-action') &&
          step.with?.push === false &&
          step.with?.load === true,
      );
      const smokeIndex = buildPush.steps.findIndex(
        (step) => step.run?.includes('/health') ?? false,
      );
      const pushIndex = buildPush.steps.findIndex(
        (step) =>
          usesAction(step, 'docker/build-push-action') &&
          step.with?.push === true,
      );

      expect(loadIndex).toBeGreaterThanOrEqual(0);
      expect(smokeIndex).toBeGreaterThan(loadIndex);
      expect(pushIndex).toBeGreaterThan(smokeIndex);
    });

    it('pushes the metadata-derived tags with provenance and SBOM', () => {
      const push = findStep(
        buildPush,
        (step) =>
          usesAction(step, 'docker/build-push-action') &&
          step.with?.push === true,
      );
      expect(push).toBeDefined();
      expect(push?.id).toBe('push');
      expect(push?.with?.file).toBe(EXPECTED_DOCKERFILE);
      expect(push?.with?.tags).toBe('${{ steps.meta.outputs.tags }}');
      expect(push?.with?.labels).toBe('${{ steps.meta.outputs.labels }}');
      expect(push?.with?.provenance).toBe(true);
      expect(push?.with?.sbom).toBe(true);
    });

    it('attests the pushed digest and stores it in the registry', () => {
      const attest = findStep(buildPush, (step) =>
        usesAction(step, 'actions/attest-build-provenance'),
      );
      expect(attest).toBeDefined();
      expect(attest?.with?.['subject-name']).toBe('${{ env.IMAGE_NAME }}');
      expect(attest?.with?.['subject-digest']).toBe(
        '${{ steps.push.outputs.digest }}',
      );
      expect(attest?.with?.['push-to-registry']).toBe(true);
    });
  });

  describe('github-release job', () => {
    it('runs only after the image publish succeeds', () => {
      expect(githubRelease.needs).toBe('build-push');
    });

    it('elevates only contents: write', () => {
      expect(githubRelease.permissions).toEqual({ contents: 'write' });
    });

    it('creates a verified-tag release with generated notes', () => {
      const release = findStep(
        githubRelease,
        (step) => step.run?.includes('gh release create') ?? false,
      );
      expect(release).toBeDefined();
      expect(release?.run).toContain('--verify-tag');
      expect(release?.run).toContain('--generate-notes');
    });
  });
});

describe('release wiring (compose, CI, and docs stay consistent)', () => {
  const workflow = loadWorkflow(RELEASE_WORKFLOW_PATH);
  const compose = composeSchema.parse(loadYaml(PROD_COMPOSE_PATH));
  const mcpService = compose.services['mcp-server'];
  if (!mcpService) {
    throw new Error(
      'docker-compose.prod.yml is missing the mcp-server service',
    );
  }

  it('docker-compose.prod.yml pulls exactly the published image', () => {
    expect(mcpService.image).toBe(`${EXPECTED_IMAGE}:\${IMAGE_TAG:-latest}`);
    expect(mcpService.image?.startsWith(`${workflow.env?.IMAGE_NAME}:`)).toBe(
      true,
    );
  });

  it('the workflow builds the same Dockerfile as the compose fallback build', () => {
    expect(mcpService.build?.dockerfile).toBe(EXPECTED_DOCKERFILE);

    const push = findStep(
      requireJob(workflow, 'build-push'),
      (step) =>
        usesAction(step, 'docker/build-push-action') &&
        step.with?.push === true,
    );
    expect(push?.with?.file).toBe(mcpService.build?.dockerfile);
  });

  it('ci.yml stays build-only: no build-push step ever pushes', () => {
    const ci = loadWorkflow(CI_WORKFLOW_PATH);
    const buildSteps = Object.values(ci.jobs).flatMap((job) =>
      job.steps.filter((step) => usesAction(step, 'docker/build-push-action')),
    );

    expect(buildSteps.length).toBeGreaterThan(0);
    for (const step of buildSteps) {
      expect(step.with?.push).toBe(false);
    }
  });

  it('docs/deploy.md documents the real flow and drops the phantom REGISTRY_TOKEN gate', () => {
    const doc = readFileSync(DEPLOY_DOC_PATH, 'utf8');

    expect(doc).toContain(EXPECTED_IMAGE);
    expect(doc).toContain('release.yml');
    expect(doc).toContain('IMAGE_TAG');
    // The pre-#201 doc claimed pushes were gated on a REGISTRY_TOKEN secret
    // that never existed anywhere in the repo.
    expect(doc).not.toContain('REGISTRY_TOKEN');
  });
});
