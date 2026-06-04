import { CavemanPrompt } from './types';

function bulletize(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0);

  if (lines.length === 0) {
    return '- no task';
  }

  return lines.map((line: string): string => `- ${line}`).join('\n');
}

export function shapeCavemanPrompt(compressedPrompt: string): CavemanPrompt {
  const instructionBlock = [
    'STYLE_RULES',
    '- speak short',
    '- keep technical truth',
    '- no fluff',
    '- output steps and result',
    '- preserve user intent',
  ].join('\n');

  const shapedPrompt = [instructionBlock, 'INPUT', bulletize(compressedPrompt)].join('\n\n');

  return {
    instructionBlock,
    shapedPrompt,
  };
}
