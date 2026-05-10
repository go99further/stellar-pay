import { describe, it, expect, beforeEach } from "vitest";
import { Graph } from "../lib/agent/graph";

describe("Graph", () => {
  describe("directed graph", () => {
    let g: Graph;

    beforeEach(() => {
      g = new Graph(true);
    });

    describe("addNode / addEdge / hasNode / hasEdge", () => {
      it("should add nodes", () => {
        g.addNode("a").addNode("b");
        expect(g.hasNode("a")).toBe(true);
        expect(g.hasNode("b")).toBe(true);
        expect(g.hasNode("c")).toBe(false);
      });

      it("should add edges and auto-create nodes", () => {
        g.addEdge("a", "b");
        expect(g.hasEdge("a", "b")).toBe(true);
        expect(g.hasEdge("b", "a")).toBe(false); // directed
      });

      it("should store edge weight", () => {
        g.addEdge("a", "b", 5);
        expect(g.getWeight("a", "b")).toBe(5);
      });

      it("should default weight to 1", () => {
        g.addEdge("a", "b");
        expect(g.getWeight("a", "b")).toBe(1);
      });

      it("should track node count", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        expect(g.nodeCount).toBe(3);
      });
    });

    describe("removeEdge / removeNode", () => {
      it("should remove an edge", () => {
        g.addEdge("a", "b");
        expect(g.removeEdge("a", "b")).toBe(true);
        expect(g.hasEdge("a", "b")).toBe(false);
      });

      it("should return false for non-existing edge", () => {
        expect(g.removeEdge("x", "y")).toBe(false);
      });

      it("should remove a node and its edges", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.removeNode("b");
        expect(g.hasNode("b")).toBe(false);
        expect(g.hasEdge("a", "b")).toBe(false);
      });

      it("should return false for non-existing node", () => {
        expect(g.removeNode("missing")).toBe(false);
      });
    });

    describe("neighbors / nodes / edges", () => {
      it("should return neighbors", () => {
        g.addEdge("a", "b");
        g.addEdge("a", "c");
        expect(g.neighbors("a").sort()).toEqual(["b", "c"]);
      });

      it("should return all nodes", () => {
        g.addEdge("a", "b");
        g.addEdge("c", "d");
        expect(g.nodes().sort()).toEqual(["a", "b", "c", "d"]);
      });

      it("should return all edges", () => {
        g.addEdge("a", "b", 2);
        g.addEdge("b", "c", 3);
        const edges = g.edges();
        expect(edges).toHaveLength(2);
        expect(edges.find((e) => e.from === "a" && e.to === "b")?.weight).toBe(2);
      });
    });

    describe("BFS", () => {
      it("should traverse in breadth-first order", () => {
        g.addEdge("a", "b");
        g.addEdge("a", "c");
        g.addEdge("b", "d");
        g.addEdge("c", "e");
        const order = g.bfs("a");
        expect(order[0]).toBe("a");
        expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
        expect(order.indexOf("c")).toBeLessThan(order.indexOf("e"));
      });

      it("should visit all reachable nodes", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        expect(g.bfs("a")).toEqual(["a", "b", "c"]);
      });

      it("should return empty for non-existing start", () => {
        expect(g.bfs("missing")).toEqual([]);
      });

      it("should not revisit nodes in cycles", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("c", "a");
        const order = g.bfs("a");
        expect(new Set(order).size).toBe(order.length);
      });
    });

    describe("DFS", () => {
      it("should traverse in depth-first order", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("a", "d");
        const order = g.dfs("a");
        expect(order[0]).toBe("a");
        expect(order).toContain("b");
        expect(order).toContain("c");
        expect(order).toContain("d");
      });

      it("should not revisit nodes", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("c", "a");
        const order = g.dfs("a");
        expect(new Set(order).size).toBe(order.length);
      });
    });

    describe("shortestPath (Dijkstra)", () => {
      it("should find shortest path", () => {
        g.addEdge("a", "b", 1);
        g.addEdge("b", "c", 2);
        g.addEdge("a", "c", 10);
        const result = g.shortestPath("a", "c");
        expect(result?.path).toEqual(["a", "b", "c"]);
        expect(result?.distance).toBe(3);
      });

      it("should return null when no path exists", () => {
        g.addNode("a");
        g.addNode("b");
        expect(g.shortestPath("a", "b")).toBeNull();
      });

      it("should return single node path for same start/end", () => {
        g.addNode("a");
        const result = g.shortestPath("a", "a");
        expect(result?.path).toEqual(["a"]);
        expect(result?.distance).toBe(0);
      });

      it("should handle weighted paths correctly", () => {
        g.addEdge("s", "a", 4);
        g.addEdge("s", "b", 2);
        g.addEdge("b", "a", 1);
        g.addEdge("a", "t", 3);
        g.addEdge("b", "t", 8);
        const result = g.shortestPath("s", "t");
        expect(result?.distance).toBe(6); // s→b→a→t = 2+1+3
        expect(result?.path).toEqual(["s", "b", "a", "t"]);
      });
    });

    describe("hasCycle", () => {
      it("should detect cycle", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("c", "a");
        expect(g.hasCycle()).toBe(true);
      });

      it("should return false for DAG", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("a", "c");
        expect(g.hasCycle()).toBe(false);
      });

      it("should return false for empty graph", () => {
        expect(g.hasCycle()).toBe(false);
      });
    });

    describe("topologicalSort", () => {
      it("should return valid topological order", () => {
        g.addEdge("a", "c");
        g.addEdge("b", "c");
        g.addEdge("c", "d");
        const order = g.topologicalSort();
        expect(order).not.toBeNull();
        expect(order!.indexOf("a")).toBeLessThan(order!.indexOf("c"));
        expect(order!.indexOf("b")).toBeLessThan(order!.indexOf("c"));
        expect(order!.indexOf("c")).toBeLessThan(order!.indexOf("d"));
      });

      it("should return null for cyclic graph", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "a");
        expect(g.topologicalSort()).toBeNull();
      });
    });
  });

  describe("undirected graph", () => {
    let g: Graph;

    beforeEach(() => {
      g = new Graph(false);
    });

    it("should add bidirectional edges", () => {
      g.addEdge("a", "b");
      expect(g.hasEdge("a", "b")).toBe(true);
      expect(g.hasEdge("b", "a")).toBe(true);
    });

    it("should remove both directions on removeEdge", () => {
      g.addEdge("a", "b");
      g.removeEdge("a", "b");
      expect(g.hasEdge("a", "b")).toBe(false);
      expect(g.hasEdge("b", "a")).toBe(false);
    });

    describe("connectedComponents", () => {
      it("should find connected components", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addNode("d");
        g.addNode("e");
        g.addEdge("d", "e");

        const components = g.connectedComponents();
        expect(components).toHaveLength(2);
        const sizes = components.map((c) => c.length).sort();
        expect(sizes).toEqual([2, 3]);
      });

      it("should return single component for fully connected graph", () => {
        g.addEdge("a", "b");
        g.addEdge("b", "c");
        g.addEdge("c", "a");
        expect(g.connectedComponents()).toHaveLength(1);
      });

      it("should return each isolated node as its own component", () => {
        g.addNode("x");
        g.addNode("y");
        g.addNode("z");
        expect(g.connectedComponents()).toHaveLength(3);
      });
    });
  });
});
