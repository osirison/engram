import { Injectable } from '@nestjs/common';
import type { PipelineStep, IngestContext } from './types.js';

/**
 * Topic buckets: each key is the tag added; each value is the set of keywords
 * that trigger detection.  The detector is additive — multiple topics can fire.
 */
const TOPIC_BUCKETS: Record<string, string[]> = {
  engineering: [
    'typescript',
    'javascript',
    'python',
    'code',
    'function',
    'class',
    'api',
    'service',
    'deploy',
    'commit',
    'branch',
    'refactor',
    'test',
    'migration',
    'schema',
    'database',
    'docker',
    'kubernetes',
    'ci',
    'pipeline',
  ],
  decision: [
    'decided',
    'decision',
    'agreed',
    'resolved',
    'approved',
    'rejected',
    'chosen',
    'selected',
    'opted',
    'settled on',
  ],
  problem: [
    'problem',
    'incident',
    'issue',
    'error',
    'failure',
    'outage',
    'bug',
    'crash',
    'broken',
    'regression',
    'defect',
    'exception',
  ],
  milestone: [
    'milestone',
    'launch',
    'shipped',
    'released',
    'deadline',
    'completed',
    'finished',
    'done',
    'achieved',
    'deployed',
    'went live',
  ],
  product: [
    'feature',
    'user',
    'customer',
    'sprint',
    'release',
    'roadmap',
    'requirement',
    'story',
    'epic',
    'backlog',
    'stakeholder',
  ],
  learning: [
    'learned',
    'discovered',
    'insight',
    'research',
    'found out',
    'realized',
    'understood',
    'note to self',
    'takeaway',
  ],
};

// Precompile each keyword as a \b…\b word-boundary regex so short tokens
// like "ci" don't match inside longer words (e.g., "decided", "decision").
const TOPIC_PATTERNS: Array<[string, RegExp[]]> = Object.entries(TOPIC_BUCKETS).map(
  ([topic, keywords]) => [
    topic,
    keywords.map((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')),
  ]
);

/**
 * Step 4 of the ingest pipeline.
 *
 * Runs a lightweight keyword scan over the content to detect topic buckets,
 * then merges them into `ctx.tags` (deduped).  Never aborts.
 * Rule-based only — no LLM or external call.
 */
@Injectable()
export class TopicDetectorStep implements PipelineStep<IngestContext> {
  readonly name = 'TopicDetector';

  execute(ctx: IngestContext): Promise<IngestContext> {
    const detected: string[] = [];

    for (const [topic, patterns] of TOPIC_PATTERNS) {
      if (patterns.some((re) => re.test(ctx.content))) {
        detected.push(topic);
      }
    }

    if (detected.length === 0) {
      return Promise.resolve(ctx);
    }

    const existingSet = new Set(ctx.tags);
    const newTags = detected.filter((t) => !existingSet.has(t));

    return Promise.resolve({
      ...ctx,
      tags: [...ctx.tags, ...newTags],
      detectedTopics: [...ctx.detectedTopics, ...detected],
    });
  }
}
