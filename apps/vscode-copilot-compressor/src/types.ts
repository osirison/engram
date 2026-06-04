export type ConversationRole = 'user' | 'assistant';

export interface ConversationTurn {
  readonly role: ConversationRole;
  readonly text: string;
}

export interface CompressionInput {
  readonly prompt: string;
  readonly history: readonly ConversationTurn[];
  readonly maxChars: number;
}

export interface CompressionOutput {
  readonly promptCore: string;
  readonly historySummary: string;
  readonly compressedPrompt: string;
  readonly originalLength: number;
  readonly compressedLength: number;
}

export interface CavemanPrompt {
  readonly instructionBlock: string;
  readonly shapedPrompt: string;
}
