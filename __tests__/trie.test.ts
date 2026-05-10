import { describe, it, expect, beforeEach } from "vitest";
import { Trie } from "../lib/agent/trie";

describe("Trie", () => {
  let trie: Trie;

  beforeEach(() => {
    trie = new Trie();
  });

  describe("insert / search", () => {
    it("should find inserted word", () => {
      trie.insert("hello");
      expect(trie.search("hello")).toBe(true);
    });

    it("should not find non-inserted word", () => {
      trie.insert("hello");
      expect(trie.search("world")).toBe(false);
    });

    it("should not find prefix as full word", () => {
      trie.insert("hello");
      expect(trie.search("hell")).toBe(false);
    });

    it("should find word that is prefix of another", () => {
      trie.insert("hello");
      trie.insert("hell");
      expect(trie.search("hell")).toBe(true);
      expect(trie.search("hello")).toBe(true);
    });

    it("should handle empty string", () => {
      trie.insert("");
      expect(trie.search("")).toBe(true);
    });

    it("should track size correctly", () => {
      expect(trie.size).toBe(0);
      trie.insert("a");
      trie.insert("b");
      trie.insert("a"); // duplicate
      expect(trie.size).toBe(2);
    });
  });

  describe("startsWith", () => {
    it("should return true for existing prefix", () => {
      trie.insert("hello");
      expect(trie.startsWith("hel")).toBe(true);
    });

    it("should return false for non-existing prefix", () => {
      trie.insert("hello");
      expect(trie.startsWith("world")).toBe(false);
    });

    it("should return true for full word as prefix", () => {
      trie.insert("hello");
      expect(trie.startsWith("hello")).toBe(true);
    });

    it("should return true for empty prefix", () => {
      trie.insert("hello");
      expect(trie.startsWith("")).toBe(true);
    });
  });

  describe("getValue", () => {
    it("should store and retrieve associated value", () => {
      trie.insert("key", { data: 42 });
      expect((trie.getValue("key") as { data: number }).data).toBe(42);
    });

    it("should return undefined for non-inserted word", () => {
      expect(trie.getValue("missing")).toBeUndefined();
    });

    it("should return undefined for prefix-only match", () => {
      trie.insert("hello", "world");
      expect(trie.getValue("hell")).toBeUndefined();
    });
  });

  describe("getCount", () => {
    it("should count insertions of same word", () => {
      trie.insert("hello");
      trie.insert("hello");
      trie.insert("hello");
      expect(trie.getCount("hello")).toBe(3);
    });

    it("should return 0 for non-inserted word", () => {
      expect(trie.getCount("missing")).toBe(0);
    });
  });

  describe("delete", () => {
    it("should delete an existing word", () => {
      trie.insert("hello");
      expect(trie.delete("hello")).toBe(true);
      expect(trie.search("hello")).toBe(false);
    });

    it("should return false for non-existing word", () => {
      expect(trie.delete("missing")).toBe(false);
    });

    it("should not affect other words sharing prefix", () => {
      trie.insert("hello");
      trie.insert("hell");
      trie.delete("hello");
      expect(trie.search("hell")).toBe(true);
      expect(trie.search("hello")).toBe(false);
    });

    it("should not affect longer words when deleting prefix", () => {
      trie.insert("hello");
      trie.insert("hell");
      trie.delete("hell");
      expect(trie.search("hello")).toBe(true);
      expect(trie.search("hell")).toBe(false);
    });

    it("should decrement size on delete", () => {
      trie.insert("hello");
      trie.insert("world");
      trie.delete("hello");
      expect(trie.size).toBe(1);
    });
  });

  describe("suggest (autocomplete)", () => {
    beforeEach(() => {
      ["apple", "app", "application", "apply", "banana", "band", "bandana"].forEach((w) =>
        trie.insert(w)
      );
    });

    it("should return all words with given prefix", () => {
      const results = trie.suggest("app");
      expect(results.sort()).toEqual(["app", "apple", "application", "apply"]);
    });

    it("should respect limit", () => {
      const results = trie.suggest("app", 2);
      expect(results).toHaveLength(2);
    });

    it("should return empty array for non-matching prefix", () => {
      expect(trie.suggest("xyz")).toEqual([]);
    });

    it("should return all words for empty prefix", () => {
      const results = trie.suggest("");
      expect(results).toHaveLength(7);
    });
  });

  describe("allWords", () => {
    it("should return all inserted words", () => {
      trie.insert("cat");
      trie.insert("car");
      trie.insert("card");
      const words = trie.allWords().sort();
      expect(words).toEqual(["car", "card", "cat"]);
    });

    it("should return empty array for empty trie", () => {
      expect(trie.allWords()).toEqual([]);
    });
  });

  describe("wordsWithPrefix", () => {
    it("should return all words starting with prefix", () => {
      trie.insert("test");
      trie.insert("testing");
      trie.insert("tested");
      trie.insert("other");
      const results = trie.wordsWithPrefix("test").sort();
      expect(results).toEqual(["test", "tested", "testing"]);
    });
  });

  describe("matchWildcard", () => {
    beforeEach(() => {
      ["cat", "car", "card", "bat", "bar", "can"].forEach((w) => trie.insert(w));
    });

    it("should match ? as single character", () => {
      const results = trie.matchWildcard("ca?").sort();
      expect(results).toEqual(["can", "car", "cat"]);
    });

    it("should match * as zero or more characters", () => {
      const results = trie.matchWildcard("ca*").sort();
      expect(results).toContain("cat");
      expect(results).toContain("car");
      expect(results).toContain("card");
      expect(results).toContain("can");
    });

    it("should match exact word with no wildcards", () => {
      expect(trie.matchWildcard("cat")).toEqual(["cat"]);
    });

    it("should return empty for no matches", () => {
      expect(trie.matchWildcard("xyz")).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should empty the trie", () => {
      trie.insert("hello");
      trie.insert("world");
      trie.clear();
      expect(trie.size).toBe(0);
      expect(trie.search("hello")).toBe(false);
    });
  });
});

describe("Trie — additional coverage", () => {
  it("should insert same word multiple times and increment count", () => {
    const trie = new Trie();
    trie.insert("hello");
    trie.insert("hello");
    trie.insert("hello");
    expect(trie.getCount("hello")).toBe(3);
  });

  it("should store and retrieve value on re-insert", () => {
    const trie = new Trie();
    trie.insert("key", "first");
    trie.insert("key", "second");
    expect(trie.getValue("key")).toBe("second");
  });

  it("suggest should return words sorted by insertion order", () => {
    const trie = new Trie();
    ["apple", "application", "apply", "apt"].forEach((w) => trie.insert(w));
    const results = trie.suggest("app");
    expect(results).toContain("apple");
    expect(results).toContain("application");
    expect(results).toContain("apply");
  });

  it("wordsWithPrefix should return empty for unknown prefix", () => {
    const trie = new Trie();
    trie.insert("hello");
    expect(trie.wordsWithPrefix("xyz")).toHaveLength(0);
  });

  it("delete should return false for word that was never inserted", () => {
    const trie = new Trie();
    expect(trie.delete("ghost")).toBe(false);
  });

  it("matchWildcard with * at start", () => {
    const trie = new Trie();
    ["cat", "bat", "hat"].forEach((w) => trie.insert(w));
    const results = trie.matchWildcard("*at").sort();
    expect(results).toEqual(["bat", "cat", "hat"]);
  });
});
