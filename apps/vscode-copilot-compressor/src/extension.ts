import * as vscode from 'vscode';

import { handleCompressionChatRequest, PARTICIPANT_ID } from './chat-participant';
import { compressInputCommand, compressSelectionCommand } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    handleCompressionChatRequest
  );
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'compressor.svg');

  context.subscriptions.push(participant);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'engram.copilotCompressor.compressSelection',
      compressSelectionCommand
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('engram.copilotCompressor.compressInput', compressInputCommand)
  );
}

export function deactivate(): void {
  // No-op: VS Code disposes registrations via context subscriptions.
}
