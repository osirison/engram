import { unauthenticatedHttpRefusal } from './http-auth-posture';

const base = {
  multiTenant: true,
  transport: 'streamable-http',
  authRequired: false,
  allowUnauthenticatedHttp: undefined as string | undefined,
};

describe('unauthenticatedHttpRefusal (G1-T1 boot fail-safe)', () => {
  it('refuses a multi-tenant streamable-http boot without auth or an explicit ack', () => {
    const refusal = unauthenticatedHttpRefusal({ ...base });
    expect(refusal).toMatch(/Refusing to start/);
    expect(refusal).toMatch(/AUTH_REQUIRED=true/);
    expect(refusal).toMatch(/ALLOW_UNAUTHENTICATED_HTTP=true/);
  });

  it('is environment-independent by construction: the decision takes no NODE_ENV input', () => {
    // The pre-G1-T1 guard only fired when NODE_ENV === 'production'. The
    // refusal must not vary with the environment label, so the input shape
    // itself excludes it — this test pins that contract.
    for (const nodeEnv of ['development', 'test', 'production', undefined]) {
      const prev = process.env.NODE_ENV;
      try {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
        expect(unauthenticatedHttpRefusal({ ...base })).toMatch(
          /Refusing to start/,
        );
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev;
      }
    }
  });

  it('allows boot when the operator explicitly acknowledges the posture', () => {
    expect(
      unauthenticatedHttpRefusal({ ...base, allowUnauthenticatedHttp: 'true' }),
    ).toBeNull();
  });

  it('does not treat a falsy flag value as an ack', () => {
    expect(
      unauthenticatedHttpRefusal({
        ...base,
        allowUnauthenticatedHttp: 'false',
      }),
    ).toMatch(/Refusing to start/);
  });

  it('allows boot when auth is required', () => {
    expect(
      unauthenticatedHttpRefusal({ ...base, authRequired: true }),
    ).toBeNull();
  });

  it('allows single-tenant profiles (memory/lite) unauthenticated', () => {
    expect(
      unauthenticatedHttpRefusal({ ...base, multiTenant: false }),
    ).toBeNull();
  });

  it('allows the stdio transport (trusted local) unauthenticated', () => {
    expect(
      unauthenticatedHttpRefusal({ ...base, transport: 'stdio' }),
    ).toBeNull();
  });
});
