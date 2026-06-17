import { describe, it, expect } from 'vitest';
import { IngestPipelineService } from './ingest-pipeline.service.js';
import { PrivacyFilterStep } from './privacy-filter.step.js';
import { TopicDetectorStep } from './topic-detector.step.js';
import { buildIngestContext } from './types.js';

function makePipeline(): IngestPipelineService {
  return new IngestPipelineService(new PrivacyFilterStep(), new TopicDetectorStep());
}

describe('IngestPipelineService', () => {
  it('runs privacy filter and topic detector', async () => {
    const pipeline = makePipeline();
    const ctx = buildIngestContext({
      userId: 'u1',
      content: 'decided to fix the typescript bug. password = secret123',
    });
    const result = await pipeline.runSyncSteps(ctx);
    expect(result.content).not.toContain('secret123');
    expect(result.tags).toContain('decision');
    expect(result.tags).toContain('engineering');
  });

  it('computes a content hash', async () => {
    const pipeline = makePipeline();
    const ctx = buildIngestContext({ userId: 'u1', content: 'hello world' });
    const result = await pipeline.runSyncSteps(ctx);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aborts when hash matches an existing set', async () => {
    const pipeline = makePipeline();
    const content = 'duplicate memory content';
    const hash = pipeline.computeHash(content);
    const ctx = buildIngestContext({ userId: 'u1', content });
    const result = await pipeline.runSyncSteps(ctx, new Set([hash]));
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('exact-duplicate');
  });

  it('does not abort when hash differs', async () => {
    const pipeline = makePipeline();
    const ctx = buildIngestContext({ userId: 'u1', content: 'unique content here' });
    const result = await pipeline.runSyncSteps(ctx, new Set(['differenthash']));
    expect(result.aborted).toBe(false);
  });

  it('produces deterministic hashes for same content', () => {
    const pipeline = makePipeline();
    const h1 = pipeline.computeHash('  Hello World  ');
    const h2 = pipeline.computeHash('hello world');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different content', () => {
    const pipeline = makePipeline();
    expect(pipeline.computeHash('foo')).not.toBe(pipeline.computeHash('bar'));
  });

  it('runAsyncHooks does not throw', () => {
    const pipeline = makePipeline();
    const ctx = buildIngestContext({ userId: 'u1', content: 'test' });
    expect(() => pipeline.runAsyncHooks(ctx, 'mem-123')).not.toThrow();
  });
});
