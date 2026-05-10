/**
 * Trie (Prefix Tree)
 *
 * Inspired by production autocomplete/search patterns:
 * - Insert, search, startsWith
 * - Autocomplete suggestions
 * - Word count / frequency
 * - Delete with cleanup
 * - Wildcard matching
 *
 * Pattern: Insert → Traverse → Match → Suggest
 */

export interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  count: number;
  value?: unknown;
}

function makeNode(): TrieNode {
  return { children: new Map(), isEnd: false, count: 0 };
}

export class Trie {
  private root: TrieNode = makeNode();
  private _size = 0;

  get size(): number { return this._size; }

  insert(word: string, value?: unknown): void {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, makeNode());
      node = node.children.get(ch)!;
    }
    if (!node.isEnd) this._size++;
    node.isEnd = true;
    node.count++;
    if (value !== undefined) node.value = value;
  }

  search(word: string): boolean {
    const node = this.traverse(word);
    return node?.isEnd === true;
  }

  startsWith(prefix: string): boolean {
    return this.traverse(prefix) !== null;
  }

  getValue(word: string): unknown {
    const node = this.traverse(word);
    return node?.isEnd ? node.value : undefined;
  }

  getCount(word: string): number {
    const node = this.traverse(word);
    return node?.isEnd ? node.count : 0;
  }

  delete(word: string): boolean {
    return this.deleteHelper(this.root, word, 0);
  }

  suggest(prefix: string, limit = 10): string[] {
    const node = this.traverse(prefix);
    if (!node) return [];
    const results: string[] = [];
    this.collectWords(node, prefix, results, limit);
    return results;
  }

  allWords(): string[] {
    return this.suggest("", Infinity);
  }

  wordsWithPrefix(prefix: string): string[] {
    return this.suggest(prefix, Infinity);
  }

  matchWildcard(pattern: string): string[] {
    const results: string[] = [];
    this.wildcardHelper(this.root, pattern, 0, "", results);
    return results;
  }

  clear(): void {
    this.root = makeNode();
    this._size = 0;
  }

  private traverse(str: string): TrieNode | null {
    let node = this.root;
    for (const ch of str) {
      if (!node.children.has(ch)) return null;
      node = node.children.get(ch)!;
    }
    return node;
  }

  private collectWords(node: TrieNode, prefix: string, results: string[], limit: number): void {
    if (results.length >= limit) return;
    if (node.isEnd) results.push(prefix);
    for (const [ch, child] of node.children) {
      if (results.length >= limit) break;
      this.collectWords(child, prefix + ch, results, limit);
    }
  }

  private deleteHelper(node: TrieNode, word: string, depth: number): boolean {
    if (depth === word.length) {
      if (!node.isEnd) return false;
      node.isEnd = false;
      node.count = 0;
      this._size--;
      return node.children.size === 0;
    }
    const ch = word[depth];
    const child = node.children.get(ch);
    if (!child) return false;
    const shouldDelete = this.deleteHelper(child, word, depth + 1);
    if (shouldDelete) node.children.delete(ch);
    return !node.isEnd && node.children.size === 0;
  }

  private wildcardHelper(
    node: TrieNode,
    pattern: string,
    depth: number,
    current: string,
    results: string[]
  ): void {
    if (depth === pattern.length) {
      if (node.isEnd) results.push(current);
      return;
    }
    const ch = pattern[depth];
    if (ch === "?") {
      for (const [c, child] of node.children) {
        this.wildcardHelper(child, pattern, depth + 1, current + c, results);
      }
    } else if (ch === "*") {
      // Match zero characters
      this.wildcardHelper(node, pattern, depth + 1, current, results);
      // Match one or more characters
      for (const [c, child] of node.children) {
        this.wildcardHelper(child, pattern, depth, current + c, results);
      }
    } else {
      const child = node.children.get(ch);
      if (child) this.wildcardHelper(child, pattern, depth + 1, current + ch, results);
    }
  }
}
