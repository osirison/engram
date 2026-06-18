import { describe, it, expect } from 'vitest';
import { TopicDetectorStep } from './topic-detector.step.js';
import { buildIngestContext } from './types.js';

function ctx(content: string, tags: string[] = []): ReturnType<typeof buildIngestContext> {
  return buildIngestContext({ userId: 'u1', content, tags });
}

describe('TopicDetectorStep', () => {
  const step = new TopicDetectorStep();

  it('detects engineering topics from code keywords', async () => {
    const result = await step.execute(ctx('refactored the typescript service to use async/await'));
    expect(result.tags).toContain('engineering');
    expect(result.detectedTopics).toContain('engineering');
  });

  it('detects decision topic', async () => {
    const result = await step.execute(ctx('decided to use Postgres over MySQL for the project'));
    expect(result.tags).toContain('decision');
  });

  it('detects problem topic', async () => {
    const result = await step.execute(ctx('production incident: outage on the payment service'));
    expect(result.tags).toContain('problem');
  });

  it('detects milestone topic', async () => {
    const result = await step.execute(ctx('shipped the v2 release to production today'));
    expect(result.tags).toContain('milestone');
  });

  it('detects learning topic', async () => {
    const result = await step.execute(
      ctx('learned that React suspense works differently than expected')
    );
    expect(result.tags).toContain('learning');
  });

  it('detects multiple topics from single content', async () => {
    const result = await step.execute(ctx('decided to fix the bug after the production incident'));
    expect(result.tags).toContain('decision');
    expect(result.tags).toContain('problem');
  });

  it('does not add duplicate tags already present', async () => {
    const result = await step.execute(ctx('typescript code refactor', ['engineering']));
    const engineeringCount = result.tags.filter((t) => t === 'engineering').length;
    expect(engineeringCount).toBe(1);
  });

  it('leaves unrelated content without topic tags', async () => {
    const result = await step.execute(ctx('the weather is nice today'));
    expect(result.detectedTopics).toHaveLength(0);
    expect(result.tags).toHaveLength(0);
  });

  it('preserves pre-existing tags', async () => {
    const result = await step.execute(ctx('typescript migration', ['backend', 'q3']));
    expect(result.tags).toContain('backend');
    expect(result.tags).toContain('q3');
    expect(result.tags).toContain('engineering');
  });

  it('does not tag engineering when "ci" appears only inside longer words', async () => {
    const result = await step.execute(ctx('we decided on a decision about pricing'));
    expect(result.tags).not.toContain('engineering');
  });
});
