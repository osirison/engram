/**
 * CLI-level tests for per-agent API-key provisioning (GAPS G1-T2): arg
 * parsing, plan validation (admin refusal, duration bounds), the per-agent
 * mint loop with already-exists / --rotate behaviour, and the once-only
 * secret rendering. ApiKeysService is mocked — the service itself is covered
 * by api-keys.service.spec.ts, and the audit attribution seam by
 * memory/per-agent-attribution-wiring.spec.ts.
 */
import type { SafeApiKey } from '@engram/database';
import {
  agentKeyLabel,
  buildProvisionPlan,
  DEFAULT_AGENT_SCOPES,
  parseArgs,
  parseExpiresInDays,
  provisionAgentKeys,
  renderOutcome,
  type AgentProvisionOutcome,
  type ProvisioningKeysService,
} from './provision-agent-keys.cli';

const safeKey = (overrides: Partial<SafeApiKey> = {}): SafeApiKey => ({
  id: 'key_1',
  name: 'agent:claude-code',
  prefix: 'eng_abcd1234',
  userId: 'qp',
  organizationId: null,
  scopes: [...DEFAULT_AGENT_SCOPES],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  ...overrides,
});

describe('provision-agent-keys CLI parseArgs', () => {
  it('parses a comma-separated --agents list with all flags', () => {
    const args = parseArgs([
      '--agents',
      'claude-code,cursor, copilot',
      '--user',
      'qp',
      '--scopes',
      'memories:read,memories:write',
      '--expires-in',
      '90d',
      '--rotate',
    ]);
    expect(args).toEqual({
      agents: ['claude-code', 'cursor', 'copilot'],
      userId: 'qp',
      scopes: ['memories:read', 'memories:write'],
      expiresIn: '90d',
      rotate: true,
    });
  });

  it('appends repeated --agents occurrences', () => {
    const args = parseArgs(['--agents', 'claude-code', '--agents', 'cursor']);
    expect(args.agents).toEqual(['claude-code', 'cursor']);
  });

  it('applies defaults when optional flags are omitted', () => {
    const args = parseArgs(['--agents', 'claude-code', '--user', 'qp']);
    expect(args).toEqual({
      agents: ['claude-code'],
      userId: 'qp',
      scopes: [],
      rotate: false,
    });
  });
});

describe('provision-agent-keys CLI buildProvisionPlan', () => {
  it('throws when --agents is missing', () => {
    expect(() => buildProvisionPlan(parseArgs(['--user', 'qp']))).toThrow(
      '--agents',
    );
  });

  it('throws when --user is missing', () => {
    expect(() =>
      buildProvisionPlan(parseArgs(['--agents', 'claude-code'])),
    ).toThrow('--user');
  });

  it('defaults scopes to read+write+delete and never admin', () => {
    const plan = buildProvisionPlan(
      parseArgs(['--agents', 'claude-code', '--user', 'qp']),
    );
    expect(plan.scopes).toEqual([
      'memories:read',
      'memories:write',
      'memories:delete',
    ]);
    expect(plan.scopes).not.toContain('admin');
  });

  it('refuses the admin scope outright', () => {
    expect(() =>
      buildProvisionPlan(
        parseArgs([
          '--agents',
          'claude-code',
          '--user',
          'qp',
          '--scopes',
          'memories:read,admin',
        ]),
      ),
    ).toThrow('admin');
  });

  it('rejects an unknown scope', () => {
    expect(() =>
      buildProvisionPlan(
        parseArgs([
          '--agents',
          'claude-code',
          '--user',
          'qp',
          '--scopes',
          'memories:everything',
        ]),
      ),
    ).toThrow('Unknown scope');
  });

  it('rejects an invalid agent name', () => {
    expect(() =>
      buildProvisionPlan(parseArgs(['--agents', 'Bad Agent!', '--user', 'qp'])),
    ).toThrow('Invalid agent name');
  });

  it('dedupes repeated agent names and scopes', () => {
    const plan = buildProvisionPlan(
      parseArgs([
        '--agents',
        'cursor,cursor',
        '--user',
        'qp',
        '--scopes',
        'memories:read,memories:read',
      ]),
    );
    expect(plan.agents).toEqual(['cursor']);
    expect(plan.scopes).toEqual(['memories:read']);
  });

  it('parses --expires-in into whole days', () => {
    const plan = buildProvisionPlan(
      parseArgs(['--agents', 'cursor', '--user', 'qp', '--expires-in', '12w']),
    );
    expect(plan.expiresInDays).toBe(84);
  });

  it('leaves expiry unset when --expires-in is omitted', () => {
    const plan = buildProvisionPlan(
      parseArgs(['--agents', 'cursor', '--user', 'qp']),
    );
    expect(plan.expiresInDays).toBeUndefined();
  });
});

describe('parseExpiresInDays', () => {
  it.each([
    ['90', 90],
    ['90d', 90],
    ['12w', 84],
    ['1y', 365],
    ['2Y', 730],
  ])('parses %s as %d days', (value, days) => {
    expect(parseExpiresInDays(value)).toBe(days);
  });

  it.each(['', 'soon', '90 days', '-5d', '0', '0d', '11y', '4000'])(
    'rejects %s',
    (value) => {
      expect(() => parseExpiresInDays(value)).toThrow('--expires-in');
    },
  );
});

describe('provisionAgentKeys', () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    agents: ['claude-code', 'cursor'],
    userId: 'qp',
    scopes: ['memories:read', 'memories:write', 'memories:delete'],
    rotate: false,
    ...overrides,
  });

  const mockService = (
    active: SafeApiKey[] = [],
  ): jest.Mocked<ProvisioningKeysService> => ({
    listApiKeys: jest.fn().mockResolvedValue(active),
    createApiKey: jest
      .fn()
      .mockImplementation((input: { name: string; scopes: string[] }) =>
        Promise.resolve({
          key: safeKey({ id: `id_${input.name}`, name: input.name }),
          rawKey: `eng_raw_${input.name}`,
        }),
      ),
    revokeApiKey: jest.fn().mockResolvedValue(safeKey()),
  });

  it('mints one distinct key per agent with the deterministic label', async () => {
    const service = mockService();
    const outcomes = await provisionAgentKeys(service, plan());

    expect(service.createApiKey).toHaveBeenCalledTimes(2);
    expect(service.createApiKey).toHaveBeenNthCalledWith(1, {
      userId: 'qp',
      name: 'agent:claude-code',
      scopes: ['memories:read', 'memories:write', 'memories:delete'],
    });
    expect(service.createApiKey).toHaveBeenNthCalledWith(2, {
      userId: 'qp',
      name: 'agent:cursor',
      scopes: ['memories:read', 'memories:write', 'memories:delete'],
    });
    expect(outcomes.map((o) => o.status)).toEqual(['created', 'created']);
    const raws = outcomes.map((o) =>
      o.status === 'already-provisioned' ? undefined : o.rawKey,
    );
    expect(new Set(raws).size).toBe(2);
    expect(service.revokeApiKey).not.toHaveBeenCalled();
  });

  it('passes expiresInDays through when the plan carries one', async () => {
    const service = mockService();
    await provisionAgentKeys(
      service,
      plan({ agents: ['cursor'], expiresInDays: 90 }),
    );
    expect(service.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ expiresInDays: 90 }),
    );
  });

  it('does NOT silently re-mint an active same-label key', async () => {
    const existing = safeKey({ id: 'key_old', name: 'agent:claude-code' });
    const service = mockService([existing]);
    const outcomes = await provisionAgentKeys(
      service,
      plan({ agents: ['claude-code'] }),
    );

    expect(service.createApiKey).not.toHaveBeenCalled();
    expect(service.revokeApiKey).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      {
        agent: 'claude-code',
        label: 'agent:claude-code',
        status: 'already-provisioned',
        key: existing,
      },
    ]);
  });

  it('revokes then re-mints the same label with --rotate', async () => {
    const existing = safeKey({ id: 'key_old', name: 'agent:claude-code' });
    const service = mockService([existing]);
    const outcomes = await provisionAgentKeys(
      service,
      plan({ agents: ['claude-code'], rotate: true }),
    );

    expect(service.revokeApiKey).toHaveBeenCalledWith('qp', 'key_old');
    expect(service.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent:claude-code' }),
    );
    expect(outcomes[0]).toMatchObject({
      status: 'rotated',
      revokedKeyIds: ['key_old'],
    });
  });

  it('only rotates the matching label; other agents are plain creates', async () => {
    const existing = safeKey({ id: 'key_old', name: 'agent:claude-code' });
    const service = mockService([existing]);
    const outcomes = await provisionAgentKeys(service, plan({ rotate: true }));

    expect(service.revokeApiKey).toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => o.status)).toEqual(['rotated', 'created']);
  });
});

describe('renderOutcome', () => {
  const created: AgentProvisionOutcome = {
    agent: 'claude-code',
    label: 'agent:claude-code',
    status: 'created',
    key: safeKey(),
    rawKey: 'eng_secret_once',
    revokedKeyIds: [],
  };

  it('prints the secret once with a store-it-now warning and wiring snippets', () => {
    const text = renderOutcome(created);
    expect(text).toContain('shown ONCE');
    expect(text).toContain('eng_secret_once');
    expect(text).toContain('export ENGRAM_API_KEY=eng_secret_once');
    expect(text).toContain('"Authorization": "Bearer eng_secret_once"');
    expect(text).toContain('docs/security/agent-keys.md');
  });

  it('explains non-recoverability and suggests --rotate when already provisioned', () => {
    const text = renderOutcome({
      agent: 'cursor',
      label: 'agent:cursor',
      status: 'already-provisioned',
      key: safeKey({ name: 'agent:cursor' }),
    });
    expect(text).toContain('ALREADY provisioned');
    expect(text).toContain('NOT recoverable');
    expect(text).toContain('--rotate');
    expect(text).not.toContain('eng_secret_once');
  });
});

describe('agentKeyLabel', () => {
  it('is deterministic: agent:<name>', () => {
    expect(agentKeyLabel('copilot')).toBe('agent:copilot');
  });
});
