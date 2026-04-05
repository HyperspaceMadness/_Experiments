import * as vscode from 'vscode';
import { SearchOptions, FileMatch, WordOccurrence } from '../models/types';

export class SearchEngine {
  private cancelSource: vscode.CancellationTokenSource | undefined;

  cancel(): void {
    this.cancelSource?.cancel();
    this.cancelSource?.dispose();
    this.cancelSource = undefined;
  }

  async search(
    options: SearchOptions,
    onProgress?: (message: string) => void
  ): Promise<FileMatch[]> {
    this.cancel();
    this.cancelSource = new vscode.CancellationTokenSource();
    const token = this.cancelSource.token;

    if (options.words.length < 2) {
      return [];
    }

    const hasFindTextInFiles = typeof (vscode.workspace as any).findTextInFiles === 'function';

    if (hasFindTextInFiles) {
      return this.searchWithFindTextInFiles(options, token, onProgress);
    } else {
      return this.searchWithReadFile(options, token, onProgress);
    }
  }

  private async searchWithFindTextInFiles(
    options: SearchOptions,
    token: vscode.CancellationToken,
    onProgress?: (message: string) => void
  ): Promise<FileMatch[]> {
    // Phase 1: Run findTextInFiles for each word, collect {uri, lineNumber} per word
    const wordFileMap = new Map<string, Map<string, number[]>>();
    // word -> Map<uriString, lineNumbers[]>

    const excludePattern = this.getExcludePattern();

    for (let i = 0; i < options.words.length; i++) {
      if (token.isCancellationRequested) { return []; }

      const word = options.words[i];
      onProgress?.(`Searching for word ${i + 1}/${options.words.length}: "${word}"`);

      const fileLines = new Map<string, number[]>();
      wordFileMap.set(word, fileLines);

      const pattern = this.buildSearchPattern(word, options);

      try {
        await (vscode.workspace as any).findTextInFiles(
          { pattern, isRegExp: true, isCaseSensitive: options.caseSensitive },
          {
            exclude: excludePattern,
            previewOptions: { matchLines: 1, charsPerLine: 200 },
          },
          (result: any) => {
            const uri = result.uri.toString();
            const line = result.ranges?.[0]?.start?.line ?? result.range?.start?.line ?? 0;
            if (!fileLines.has(uri)) {
              fileLines.set(uri, []);
            }
            fileLines.get(uri)!.push(line);
          },
          token
        );
      } catch {
        // Search cancelled or errored
        if (token.isCancellationRequested) { return []; }
      }
    }

    onProgress?.('Processing results...');

    // Phase 2: Find files with 2+ unique words matched
    const allUris = new Set<string>();
    for (const fileLines of wordFileMap.values()) {
      for (const uri of fileLines.keys()) {
        allUris.add(uri);
      }
    }

    const results: FileMatch[] = [];

    for (const uriStr of allUris) {
      if (token.isCancellationRequested) { return []; }

      const occurrences: WordOccurrence[] = [];
      const matchedWords = new Set<string>();

      for (const word of options.words) {
        const fileLines = wordFileMap.get(word);
        const lines = fileLines?.get(uriStr);
        if (lines && lines.length > 0) {
          matchedWords.add(word);
          for (const line of lines) {
            occurrences.push({ lineNumber: line, word });
          }
        }
      }

      if (matchedWords.size < 2) { continue; }

      const spanResult = this.computeSmallestSpan(occurrences, options.words.length);

      // Apply proximity filter
      if (options.proximity.enabled && spanResult.span > options.proximity.lines) {
        continue;
      }

      results.push({
        uri: vscode.Uri.parse(uriStr),
        matchedWordCount: matchedWords.size,
        totalWords: options.words.length,
        smallestSpan: spanResult.span,
        bestSpanStart: spanResult.start,
        bestSpanEnd: spanResult.end,
        bestSpanWords: spanResult.words,
        occurrences,
      });
    }

    return this.rankResults(results);
  }

  private async searchWithReadFile(
    options: SearchOptions,
    token: vscode.CancellationToken,
    onProgress?: (message: string) => void
  ): Promise<FileMatch[]> {
    // Fallback: find all files, read each, match words
    onProgress?.('Finding files...');

    const excludePattern = this.getExcludePattern();
    const files = await vscode.workspace.findFiles('**/*', excludePattern, undefined, token);

    if (token.isCancellationRequested) { return []; }

    const config = vscode.workspace.getConfiguration('multiwordSearch');
    const maxFileSize = config.get<number>('maxFileSize', 1048576);

    const results: FileMatch[] = [];
    const batchSize = 50;

    for (let i = 0; i < files.length; i += batchSize) {
      if (token.isCancellationRequested) { return []; }
      onProgress?.(`Scanning files ${i + 1}-${Math.min(i + batchSize, files.length)} of ${files.length}...`);

      const batch = files.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(uri => this.searchSingleFile(uri, options, maxFileSize))
      );

      for (const result of batchResults) {
        if (result) { results.push(result); }
      }
    }

    return this.rankResults(results);
  }

  private async searchSingleFile(
    uri: vscode.Uri,
    options: SearchOptions,
    maxFileSize: number
  ): Promise<FileMatch | null> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxFileSize || stat.type !== vscode.FileType.File) {
        return null;
      }

      const content = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8').decode(content);

      // Skip binary files (check for null bytes in first 512 chars)
      if (text.slice(0, 512).includes('\0')) {
        return null;
      }

      const lines = text.split('\n');
      const occurrences: WordOccurrence[] = [];
      const matchedWords = new Set<string>();

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = options.caseSensitive ? lines[lineNum] : lines[lineNum].toLowerCase();
        for (const word of options.words) {
          const searchWord = options.caseSensitive ? word : word.toLowerCase();
          if (options.wholeWord) {
            const regex = new RegExp(`\\b${this.escapeRegex(searchWord)}\\b`, options.caseSensitive ? '' : 'i');
            if (regex.test(lines[lineNum])) {
              matchedWords.add(word);
              occurrences.push({ lineNumber: lineNum, word });
            }
          } else {
            if (line.includes(searchWord)) {
              matchedWords.add(word);
              occurrences.push({ lineNumber: lineNum, word });
            }
          }
        }
      }

      if (matchedWords.size < 2) { return null; }

      const spanResult = this.computeSmallestSpan(occurrences, options.words.length);

      if (options.proximity.enabled && spanResult.span > options.proximity.lines) {
        return null;
      }

      return {
        uri,
        matchedWordCount: matchedWords.size,
        totalWords: options.words.length,
        smallestSpan: spanResult.span,
        bestSpanStart: spanResult.start,
        bestSpanEnd: spanResult.end,
        bestSpanWords: spanResult.words,
        occurrences,
      };
    } catch {
      return null;
    }
  }

  private buildSearchPattern(word: string, options: SearchOptions): string {
    const escaped = this.escapeRegex(word);
    if (options.wholeWord) {
      return `\\b${escaped}\\b`;
    }
    return escaped;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private computeSmallestSpan(
    occurrences: WordOccurrence[],
    totalWords: number
  ): { span: number; start: number; end: number; words: string[] } {
    if (occurrences.length === 0) {
      return { span: Infinity, start: 0, end: 0, words: [] };
    }

    // Sort by line number
    const sorted = [...occurrences].sort((a, b) => a.lineNumber - b.lineNumber);

    let bestSpan = Infinity;
    let bestStart = 0;
    let bestEnd = 0;
    let bestWords: string[] = [];

    // Sliding window: find smallest window containing the most distinct words
    // First try to find a window with all words, then with totalWords-1, etc.
    for (let targetCount = totalWords; targetCount >= 2; targetCount--) {
      let left = 0;
      const windowWords = new Map<string, number>(); // word -> count in window

      for (let right = 0; right < sorted.length; right++) {
        const rWord = sorted[right].word;
        windowWords.set(rWord, (windowWords.get(rWord) || 0) + 1);

        // Shrink window from left while we still have enough distinct words
        while (left < right) {
          const lWord = sorted[left].word;
          const lCount = windowWords.get(lWord) || 0;
          if (lCount > 1 || windowWords.size > targetCount) {
            if (lCount > 1) {
              windowWords.set(lWord, lCount - 1);
            } else {
              windowWords.delete(lWord);
            }
            left++;
          } else {
            break;
          }
        }

        if (windowWords.size >= targetCount) {
          const span = sorted[right].lineNumber - sorted[left].lineNumber;
          if (span < bestSpan || (span === bestSpan && windowWords.size > bestWords.length)) {
            bestSpan = span;
            bestStart = sorted[left].lineNumber;
            bestEnd = sorted[right].lineNumber;
            bestWords = [...windowWords.keys()];
          }
        }
      }

      if (bestSpan < Infinity) { break; }
    }

    return { span: bestSpan, start: bestStart, end: bestEnd, words: bestWords };
  }

  private rankResults(results: FileMatch[]): FileMatch[] {
    return results.sort((a, b) => {
      // Primary: more matched words first
      if (b.matchedWordCount !== a.matchedWordCount) {
        return b.matchedWordCount - a.matchedWordCount;
      }
      // Secondary: smaller span (closer proximity) first
      return a.smallestSpan - b.smallestSpan;
    });
  }

  private getExcludePattern(): string {
    const config = vscode.workspace.getConfiguration('multiwordSearch');
    const patterns = config.get<string[]>('excludePatterns', ['**/node_modules/**', '**/.git/**']);
    return `{${patterns.join(',')}}`;
  }
}
