import * as vscode from 'vscode';

import { shapeCavemanPrompt } from './caveman-mode';
import { compressContext } from './context-compressor';

function getMaxPromptChars(): number {
  return vscode.workspace
    .getConfiguration('engram.copilotCompressor')
    .get<number>('maxPromptChars', 1400);
}

function compressValue(value: string): string {
  const compressed = compressContext({
    prompt: value,
    history: [],
    maxChars: getMaxPromptChars(),
  });

  return shapeCavemanPrompt(compressed.compressedPrompt).shapedPrompt;
}

async function writeToClipboard(value: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
}

export async function compressSelectionCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    void vscode.window.showWarningMessage('Open an editor and select text to compress.');
    return;
  }

  const selection = editor.document.getText(editor.selection).trim();
  if (selection.length === 0) {
    void vscode.window.showWarningMessage('Select text before running compression.');
    return;
  }

  const shaped = compressValue(selection);
  await writeToClipboard(shaped);
  void vscode.window.showInformationMessage('Compressed caveman prompt copied to clipboard.');
}

export async function compressInputCommand(): Promise<void> {
  const value = await vscode.window.showInputBox({
    prompt: 'Enter prompt text to compress',
    ignoreFocusOut: true,
  });

  if (!value || value.trim().length === 0) {
    return;
  }

  const shaped = compressValue(value);
  await writeToClipboard(shaped);
  void vscode.window.showInformationMessage('Compressed caveman prompt copied to clipboard.');
}
