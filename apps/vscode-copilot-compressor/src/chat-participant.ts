import * as vscode from 'vscode';

import { shapeCavemanPrompt } from './caveman-mode';
import { compressContext } from './context-compressor';
import { ConversationTurn } from './types';

export const PARTICIPANT_ID = 'engram.compressor';
type ChatHistoryTurn = vscode.ChatContext['history'][number];

function readConfig(): { maxPromptChars: number; includeHistory: boolean } {
  const config = vscode.workspace.getConfiguration('engram.copilotCompressor');

  return {
    maxPromptChars: config.get<number>('maxPromptChars', 1400),
    includeHistory: config.get<boolean>('includeHistory', true),
  };
}

function asConversationTurn(turn: ChatHistoryTurn): ConversationTurn | null {
  if ('prompt' in turn) {
    return {
      role: 'user',
      text: turn.prompt,
    };
  }

  return null;
}

function collectHistory(context: vscode.ChatContext, includeHistory: boolean): ConversationTurn[] {
  if (!includeHistory) {
    return [];
  }

  const history: ConversationTurn[] = [];

  for (const turn of context.history) {
    const mapped = asConversationTurn(turn);
    if (mapped === null) {
      continue;
    }

    history.push(mapped);
  }

  return history;
}

function formatOutputSection(title: string, value: string): string {
  return [`### ${title}`, '```text', value, '```'].join('\n');
}

async function streamModelResponse(
  stream: vscode.ChatResponseStream,
  shapedPrompt: string,
  token: vscode.CancellationToken
): Promise<boolean> {
  const models = await vscode.lm.selectChatModels({});
  const model = models[0];
  if (!model) {
    return false;
  }

  const request = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(shapedPrompt)],
    {},
    token
  );

  for await (const fragment of request.text) {
    stream.markdown(fragment);
  }

  return true;
}

export const handleCompressionChatRequest: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> => {
  const settings = readConfig();
  const history = collectHistory(context, settings.includeHistory);

  const compressed = compressContext({
    prompt: request.prompt,
    history,
    maxChars: settings.maxPromptChars,
  });

  const command = request.command?.toLowerCase();
  const shouldShape = command !== 'raw';

  if (!shouldShape) {
    stream.markdown(formatOutputSection('Compressed Prompt', compressed.compressedPrompt));
    stream.markdown(
      `Original chars: ${compressed.originalLength} | Compressed chars: ${compressed.compressedLength}`
    );
    return;
  }

  const caveman = shapeCavemanPrompt(compressed.compressedPrompt);

  stream.markdown(formatOutputSection('Caveman Prompt', caveman.shapedPrompt));
  stream.markdown(
    `Original chars: ${compressed.originalLength} | Compressed chars: ${compressed.compressedLength}`
  );

  const streamedFromModel = await streamModelResponse(stream, caveman.shapedPrompt, token);
  if (!streamedFromModel) {
    stream.markdown(
      'No language model is currently available in this environment. Use the caveman prompt block directly in your model call path.'
    );
  }
};
