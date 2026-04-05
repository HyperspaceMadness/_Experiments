import * as vscode from 'vscode';
import { SearchEngine } from '../search/searchEngine';
import { SearchOptions, SearchState, SerializedFileMatch } from '../models/types';

export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'multiwordSearch.searchView';

  private view?: vscode.WebviewView;
  private searchEngine: SearchEngine;
  private history: SearchState[] = [];
  private historyIndex = -1;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.searchEngine = new SearchEngine();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'search':
          await this.handleSearch(message);
          break;
        case 'openFile':
          await this.handleOpenFile(message);
          break;
        case 'back':
          this.navigateHistory(-1);
          break;
        case 'forward':
          this.navigateHistory(1);
          break;
        case 'cancel':
          this.searchEngine.cancel();
          break;
        case 'clear':
          this.searchEngine.cancel();
          break;
      }
    });
  }

  private async handleSearch(message: any): Promise<void> {
    const words = (message.query as string)
      .trim()
      .split(/\s+/)
      .filter((w: string) => w.length > 0);

    if (words.length < 2) {
      this.view?.webview.postMessage({
        command: 'error',
        message: 'Enter at least 2 words to search for.',
      });
      return;
    }

    const options: SearchOptions = {
      words,
      caseSensitive: message.caseSensitive ?? false,
      wholeWord: message.wholeWord ?? false,
      proximity: {
        enabled: message.proximityEnabled ?? false,
        lines: message.proximityLines ?? 1,
      },
    };

    this.view?.webview.postMessage({ command: 'searchStarted' });

    try {
      const results = await this.searchEngine.search(options, (msg) => {
        this.view?.webview.postMessage({ command: 'progress', message: msg });
      });

      const serialized: SerializedFileMatch[] = results.map((r) => ({
        uriString: r.uri.toString(),
        matchedWordCount: r.matchedWordCount,
        totalWords: r.totalWords,
        smallestSpan: r.smallestSpan,
        bestSpanStart: r.bestSpanStart,
        bestSpanEnd: r.bestSpanEnd,
        bestSpanWords: r.bestSpanWords,
        occurrences: r.occurrences,
      }));

      // Save to history
      const state: SearchState = {
        query: message.query,
        caseSensitive: message.caseSensitive ?? false,
        wholeWord: message.wholeWord ?? false,
        multiWord: true,
        proximityEnabled: message.proximityEnabled ?? false,
        proximityLines: message.proximityLines ?? 1,
        results: serialized,
      };

      // Truncate forward history
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(state);
      this.historyIndex = this.history.length - 1;

      this.view?.webview.postMessage({
        command: 'results',
        data: serialized,
        totalFiles: serialized.length,
        canBack: this.historyIndex > 0,
        canForward: false,
      });
    } catch (err: any) {
      this.view?.webview.postMessage({
        command: 'error',
        message: err?.message || 'Search failed.',
      });
    }
  }

  private navigateHistory(direction: number): void {
    const newIndex = this.historyIndex + direction;
    if (newIndex < 0 || newIndex >= this.history.length) { return; }

    this.historyIndex = newIndex;
    const state = this.history[this.historyIndex];

    this.view?.webview.postMessage({
      command: 'restoreState',
      state,
      canBack: this.historyIndex > 0,
      canForward: this.historyIndex < this.history.length - 1,
    });
  }

  private async handleOpenFile(message: any): Promise<void> {
    try {
      const uri = vscode.Uri.parse(message.uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      const line = message.line ?? 0;
      const range = new vscode.Range(line, 0, line, 0);
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      // File may no longer exist
    }
  }

  clearResults(): void {
    this.searchEngine.cancel();
    this.view?.webview.postMessage({ command: 'clear' });
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'searchView.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'searchView.js')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${cssUri}" rel="stylesheet">
</head>
<body>
  <div id="toolbar">
    <button id="btn-back" class="icon-btn" title="Previous search" disabled>
      <span class="codicon">&#x2190;</span>
    </button>
    <button id="btn-forward" class="icon-btn" title="Next search" disabled>
      <span class="codicon">&#x2192;</span>
    </button>
  </div>

  <div id="search-controls">
    <div class="input-row">
      <input type="text" id="search-input" placeholder="Enter words separated by spaces..." />
    </div>

    <div class="options-row">
      <label class="option" title="Case Sensitive">
        <input type="checkbox" id="opt-case" />
        <span>Aa</span>
      </label>
      <label class="option" title="Match Whole Word">
        <input type="checkbox" id="opt-whole-word" />
        <span>[ab]</span>
      </label>
    </div>

    <div class="checkbox-row">
      <label>
        <input type="checkbox" id="opt-multi-word" checked />
        Multi-word search
      </label>
    </div>

    <div id="proximity-section" class="checkbox-row" style="display:none;">
      <label>
        <input type="checkbox" id="opt-proximity" />
        Within consecutive lines:
      </label>
      <input type="number" id="opt-proximity-lines" min="1" value="1" class="spin-box" />
    </div>

    <button id="btn-search" class="primary-btn">Search</button>
  </div>

  <div id="progress" style="display:none;">
    <span id="progress-text">Searching...</span>
    <button id="btn-cancel" class="small-btn">Cancel</button>
  </div>

  <div id="results-summary" style="display:none;"></div>
  <div id="results"></div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }
}
