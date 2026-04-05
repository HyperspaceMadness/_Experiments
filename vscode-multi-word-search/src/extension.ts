import * as vscode from 'vscode';
import { SearchViewProvider } from './providers/searchViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new SearchViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SearchViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('multiwordSearch.focus', () => {
      vscode.commands.executeCommand('multiwordSearch.searchView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('multiwordSearch.clearResults', () => {
      provider.clearResults();
    })
  );
}

export function deactivate() {}
