import type { HarnessReport } from './types.js';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Render a harness report as a human-readable plain-text block suitable for
 * printing to a terminal or capturing in CI logs.
 */
export function formatReport(report: HarnessReport, label: string): string {
  const lines: string[] = [];

  lines.push(`Retrieval evaluation: ${label}`);
  lines.push(`Queries: ${report.queryCount}  |  k = ${report.k}`);
  lines.push('');
  lines.push('Aggregate metrics');
  lines.push(`  precision@${report.k}  ${pct(report.precisionAtK)}`);
  lines.push(`  recall@${report.k}     ${pct(report.recallAtK)}`);
  lines.push(`  MRR            ${report.mrr.toFixed(3)}`);
  lines.push(`  nDCG@${report.k}       ${report.ndcgAtK.toFixed(3)}`);
  lines.push('');
  lines.push('Per-query nDCG');
  for (const result of report.perQuery) {
    lines.push(
      `  ${result.queryId.padEnd(20)} ${result.ndcgAtK.toFixed(3)}  rr=${result.reciprocalRank.toFixed(3)}`
    );
  }

  return lines.join('\n');
}
