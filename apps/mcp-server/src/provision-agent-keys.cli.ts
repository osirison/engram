/**
 * Standalone per-agent API-key provisioning CLI (GAPS G1-T2).
 *
 * Mints one DISTINCT `eng_` API key per agent against a SINGLE shared tenant
 * (`userId`) — per the pinned decision (STATE-G1-G4 Decision 7): attribution
 * comes from `MemoryAudit.actorId` (the verified key id), while the memory
 * pool stays shared. It never grants the `admin` scope.
 *
 * Each key's plaintext is printed ONCE — the server stores only a hash. An
 * existing active key with the same label is reported (not silently
 * re-minted); pass `--rotate` to revoke it and mint a replacement.
 *
 * Usage (from repo root):
 *   pnpm --filter mcp-server provision-agent-keys -- \
 *     --agents claude-code,cursor,copilot --user qp \
 *     [--scopes memories:read,memories:write,memories:delete] \
 *     [--expires-in <duration>] [--rotate]
 *
 * Options:
 *   --agents <a,b,c>    Comma-separated agent names (repeatable; required).
 *                       Each yields one key labelled `agent:<name>`.
 *   --user <id>         Tenant userId shared by every key (required).
 *   --scopes <s,t>      Scopes for every minted key. Default:
 *                       memories:read,memories:write,memories:delete.
 *                       `admin` is refused — operator-only, never an agent key.
 *   --expires-in <dur>  Key lifetime: `<n>d` days, `<n>w` weeks, `<n>y` years,
 *                       or a bare number of days (1–3650). Default: no expiry.
 *   --rotate            Revoke an existing active `agent:<name>` key and mint
 *                       a fresh one instead of reporting it.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ApiKeyScope } from '@engram/database';
import type { SafeApiKey } from '@engram/database';
import { AppModule } from './app.module';
import { ApiKeysService } from './api-keys/api-keys.service';

/** Scopes an agent key may carry. `admin` is deliberately absent. */
export const AGENT_GRANTABLE_SCOPES: readonly string[] = [
  ApiKeyScope.MEMORIES_READ,
  ApiKeyScope.MEMORIES_WRITE,
  ApiKeyScope.MEMORIES_DELETE,
];

/** Default per-agent scopes: read+write+delete, never admin (Decision 7). */
export const DEFAULT_AGENT_SCOPES: readonly string[] = [
  ApiKeyScope.MEMORIES_READ,
  ApiKeyScope.MEMORIES_WRITE,
  ApiKeyScope.MEMORIES_DELETE,
];

const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export interface ProvisionCliArgs {
  agents: string[];
  userId?: string;
  scopes: string[];
  expiresIn?: string;
  rotate: boolean;
}

/** Validated, ready-to-run provisioning plan. */
export interface ProvisionPlan {
  agents: string[];
  userId: string;
  scopes: string[];
  expiresInDays?: number;
  rotate: boolean;
}

export function parseArgs(argv: readonly string[]): ProvisionCliArgs {
  const args: ProvisionCliArgs = { agents: [], scopes: [], rotate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--agents':
        args.agents.push(...splitList(argv[(i += 1)]));
        break;
      case '--user':
        args.userId = argv[(i += 1)];
        break;
      case '--scopes':
        args.scopes.push(...splitList(argv[(i += 1)]));
        break;
      case '--expires-in':
        args.expiresIn = argv[(i += 1)];
        break;
      case '--rotate':
        args.rotate = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parse an `--expires-in` duration into whole days: `<n>d` days, `<n>w`
 * weeks, `<n>y` years, or a bare integer of days. Bounds match the
 * `create_api_key` DTO (1–3650 days). Throws on anything else.
 */
export function parseExpiresInDays(value: string): number {
  const match = /^(\d+)(d|w|y)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(
      `--expires-in is not a valid duration: "${value}" (use e.g. 90d, 12w, 1y)`,
    );
  }
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unit = (match[2] ?? 'd').toLowerCase();
  const days = amount * (unit === 'y' ? 365 : unit === 'w' ? 7 : 1);
  if (days < 1 || days > 3650) {
    throw new Error(
      `--expires-in must resolve to 1–3650 days, got ${days} ("${value}")`,
    );
  }
  return days;
}

/** Deterministic per-agent key label: `agent:<name>`. */
export function agentKeyLabel(agent: string): string {
  return `agent:${agent}`;
}

/**
 * Validate parsed args into a runnable plan. Throws with an operator-friendly
 * message on missing/invalid input. Refuses the `admin` scope outright.
 */
export function buildProvisionPlan(args: ProvisionCliArgs): ProvisionPlan {
  if (args.agents.length === 0) {
    throw new Error('--agents <name,name,...> is required');
  }
  if (!args.userId) {
    throw new Error('--user <id> is required');
  }
  const agents = [...new Set(args.agents)];
  for (const agent of agents) {
    if (!AGENT_NAME_PATTERN.test(agent)) {
      throw new Error(
        `Invalid agent name "${agent}" (lowercase letters, digits, ` +
          `".", "_", "-"; max 63 chars)`,
      );
    }
  }
  const scopes =
    args.scopes.length > 0
      ? [...new Set(args.scopes)]
      : [...DEFAULT_AGENT_SCOPES];
  for (const scope of scopes) {
    if (scope === ApiKeyScope.ADMIN) {
      throw new Error(
        'Refusing to mint an agent key with the "admin" scope — admin is ' +
          'operator-only (docs/security/agent-keys.md). Remove it from --scopes.',
      );
    }
    if (!AGENT_GRANTABLE_SCOPES.includes(scope)) {
      throw new Error(
        `Unknown scope "${scope}" (valid: ${AGENT_GRANTABLE_SCOPES.join(', ')})`,
      );
    }
  }
  return {
    agents,
    userId: args.userId,
    scopes,
    ...(args.expiresIn !== undefined
      ? { expiresInDays: parseExpiresInDays(args.expiresIn) }
      : {}),
    rotate: args.rotate,
  };
}

/** The slice of ApiKeysService the provisioning flow needs (mockable). */
export type ProvisioningKeysService = Pick<
  ApiKeysService,
  'createApiKey' | 'listApiKeys' | 'revokeApiKey'
>;

export type AgentProvisionOutcome =
  | {
      agent: string;
      label: string;
      status: 'created' | 'rotated';
      key: SafeApiKey;
      /** Plaintext key — shown once, never stored. */
      rawKey: string;
      /** Ids of same-label keys revoked by --rotate (empty when created). */
      revokedKeyIds: string[];
    }
  | {
      agent: string;
      label: string;
      status: 'already-provisioned';
      key: SafeApiKey;
    };

/**
 * Provision one distinct key per agent under the single shared tenant.
 * An active key whose name equals the agent label short-circuits to
 * `already-provisioned` unless `rotate` is set (revoke all same-label
 * actives, then mint).
 */
export async function provisionAgentKeys(
  service: ProvisioningKeysService,
  plan: ProvisionPlan,
): Promise<AgentProvisionOutcome[]> {
  // listApiKeys returns only active keys (not revoked, not expired).
  const active = await service.listApiKeys(plan.userId);
  const outcomes: AgentProvisionOutcome[] = [];

  for (const agent of plan.agents) {
    const label = agentKeyLabel(agent);
    const existing = active.filter((key) => key.name === label);

    if (existing.length > 0 && !plan.rotate) {
      outcomes.push({
        agent,
        label,
        status: 'already-provisioned',
        key: existing[0]!,
      });
      continue;
    }

    const revokedKeyIds: string[] = [];
    for (const key of existing) {
      await service.revokeApiKey(plan.userId, key.id);
      revokedKeyIds.push(key.id);
    }

    const { key, rawKey } = await service.createApiKey({
      userId: plan.userId,
      name: label,
      scopes: [...plan.scopes],
      ...(plan.expiresInDays !== undefined
        ? { expiresInDays: plan.expiresInDays }
        : {}),
    });

    outcomes.push({
      agent,
      label,
      status: revokedKeyIds.length > 0 ? 'rotated' : 'created',
      key,
      rawKey,
      revokedKeyIds,
    });
  }

  return outcomes;
}

const RULE = '─'.repeat(64);

/**
 * Human-readable block for one agent outcome, including the once-only secret
 * and ready-to-paste wiring snippets (docs/security/agent-keys.md → "Where
 * each key goes").
 */
export function renderOutcome(outcome: AgentProvisionOutcome): string {
  const lines: string[] = ['', `${RULE}`, `agent: ${outcome.agent}`, RULE];

  if (outcome.status === 'already-provisioned') {
    lines.push(
      `  "${outcome.label}" is ALREADY provisioned and active ` +
        `(id=${outcome.key.id}, prefix=${outcome.key.prefix}, ` +
        `created=${outcome.key.createdAt.toISOString()}).`,
      '  The plaintext secret is NOT recoverable (only a hash is stored).',
      '  No new key was minted. To issue a fresh key, re-run with --rotate',
      '  (revokes the old key, then mints a replacement).',
    );
    return lines.join('\n');
  }

  if (outcome.status === 'rotated') {
    lines.push(
      `  Rotated: revoked ${outcome.revokedKeyIds.length} old key(s) ` +
        `[${outcome.revokedKeyIds.join(', ')}].`,
    );
  }
  lines.push(
    `  key name : ${outcome.label}`,
    `  key id   : ${outcome.key.id}`,
    `  prefix   : ${outcome.key.prefix}`,
    `  userId   : ${outcome.key.userId}`,
    `  scopes   : ${outcome.key.scopes.join(', ')}`,
    `  expires  : ${
      outcome.key.expiresAt ? outcome.key.expiresAt.toISOString() : 'never'
    }`,
    '',
    '  !! API KEY — shown ONCE, store it now. The server keeps only a hash',
    '  !! and can never display it again (lost key => revoke + re-mint).',
    '',
    `      ${outcome.rawKey}`,
    '',
    '  Wire it into this agent (never commit it — see',
    '  docs/security/agent-keys.md "Where each key goes" and',
    '  docs/agent-memory-clients.md for exact per-client config):',
    '',
    '    # Option A — env var (engram CLI bridge / hook wrappers)',
    `    export ENGRAM_API_KEY=${outcome.rawKey}`,
    '',
    '    # Option B — MCP config header',
    `    "headers": { "Authorization": "Bearer ${outcome.rawKey}" }`,
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const logger = new Logger('ProvisionAgentKeysCli');

  let plan: ProvisionPlan;
  try {
    plan = buildProvisionPlan(parseArgs(process.argv.slice(2)));
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), {
    bufferLogs: false,
  });

  try {
    const service = app.get(ApiKeysService);
    logger.log(
      `Provisioning ${plan.agents.length} agent key(s) for user=${plan.userId} ` +
        `scopes=[${plan.scopes.join(', ')}]${plan.rotate ? ' (rotate)' : ''}`,
    );

    const outcomes = await provisionAgentKeys(service, plan);
    for (const outcome of outcomes) {
      process.stdout.write(`${renderOutcome(outcome)}\n`);
    }

    const skipped = outcomes.filter(
      (o) => o.status === 'already-provisioned',
    ).length;
    logger.log(
      `Done: ${outcomes.length - skipped} key(s) minted, ${skipped} already ` +
        'provisioned (re-run with --rotate to replace those).',
    );
  } catch (error) {
    logger.error(
      `Provisioning failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only bootstrap when run directly (not when imported by tests).
if (require.main === module) {
  void main().finally(() => {
    process.exit(process.exitCode ?? 0);
  });
}
