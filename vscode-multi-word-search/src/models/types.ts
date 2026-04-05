import * as vscode from 'vscode';

export interface SearchOptions {
  words: string[];
  caseSensitive: boolean;
  wholeWord: boolean;
  proximity: {
    enabled: boolean;
    lines: number;
  };
}

export interface WordOccurrence {
  lineNumber: number;
  word: string;
}

export interface FileMatch {
  uri: vscode.Uri;
  matchedWordCount: number;
  totalWords: number;
  smallestSpan: number;
  bestSpanStart: number;
  bestSpanEnd: number;
  bestSpanWords: string[];
  occurrences: WordOccurrence[];
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  multiWord: boolean;
  proximityEnabled: boolean;
  proximityLines: number;
  results: SerializedFileMatch[];
}

export interface SerializedFileMatch {
  uriString: string;
  matchedWordCount: number;
  totalWords: number;
  smallestSpan: number;
  bestSpanStart: number;
  bestSpanEnd: number;
  bestSpanWords: string[];
  occurrences: WordOccurrence[];
}
