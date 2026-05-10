/**
 * Graph (Directed/Undirected)
 *
 * Inspired by production graph algorithm patterns:
 * - Adjacency list representation
 * - BFS / DFS traversal
 * - Shortest path (Dijkstra)
 * - Cycle detection
 * - Topological sort
 * - Connected components
 *
 * Pattern: Build → Traverse → Analyze → Pathfind
 */

export interface GraphEdge<W = number> {
  from: string;
  to: string;
  weight: W;
}

export interface PathResult {
  path: string[];
  distance: number;
}

export class Graph {
  private adjacency: Map<string, Map<string, number>> = new Map();
  private directed: boolean;

  constructor(directed = true) {
    this.directed = directed;
  }

  addNode(id: string): this {
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Map());
    return this;
  }

  addEdge(from: string, to: string, weight = 1): this {
    this.addNode(from);
    this.addNode(to);
    this.adjacency.get(from)!.set(to, weight);
    if (!this.directed) this.adjacency.get(to)!.set(from, weight);
    return this;
  }

  removeEdge(from: string, to: string): boolean {
    const deleted = this.adjacency.get(from)?.delete(to) ?? false;
    if (!this.directed) this.adjacency.get(to)?.delete(from);
    return deleted;
  }

  removeNode(id: string): boolean {
    if (!this.adjacency.has(id)) return false;
    this.adjacency.delete(id);
    for (const neighbors of this.adjacency.values()) neighbors.delete(id);
    return true;
  }

  hasNode(id: string): boolean { return this.adjacency.has(id); }
  hasEdge(from: string, to: string): boolean { return this.adjacency.get(from)?.has(to) ?? false; }
  getWeight(from: string, to: string): number | undefined { return this.adjacency.get(from)?.get(to); }
  neighbors(id: string): string[] { return [...(this.adjacency.get(id)?.keys() ?? [])]; }
  nodes(): string[] { return [...this.adjacency.keys()]; }
  get nodeCount(): number { return this.adjacency.size; }

  edges(): GraphEdge[] {
    const result: GraphEdge[] = [];
    for (const [from, neighbors] of this.adjacency) {
      for (const [to, weight] of neighbors) {
        result.push({ from, to, weight });
      }
    }
    return result;
  }

  bfs(start: string): string[] {
    if (!this.adjacency.has(start)) return [];
    const visited = new Set<string>();
    const queue = [start];
    const order: string[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const neighbor of this.adjacency.get(node)?.keys() ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return order;
  }

  dfs(start: string): string[] {
    if (!this.adjacency.has(start)) return [];
    const visited = new Set<string>();
    const order: string[] = [];
    const visit = (node: string) => {
      visited.add(node);
      order.push(node);
      for (const neighbor of this.adjacency.get(node)?.keys() ?? []) {
        if (!visited.has(neighbor)) visit(neighbor);
      }
    };
    visit(start);
    return order;
  }

  shortestPath(start: string, end: string): PathResult | null {
    if (!this.adjacency.has(start) || !this.adjacency.has(end)) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const unvisited = new Set(this.adjacency.keys());

    for (const node of unvisited) dist.set(node, Infinity);
    dist.set(start, 0);

    while (unvisited.size > 0) {
      let u: string | null = null;
      let minDist = Infinity;
      for (const node of unvisited) {
        const d = dist.get(node)!;
        if (d < minDist) { minDist = d; u = node; }
      }
      if (u === null || dist.get(u) === Infinity) break;
      unvisited.delete(u);
      if (u === end) break;

      for (const [neighbor, weight] of this.adjacency.get(u)!) {
        const alt = dist.get(u)! + weight;
        if (alt < dist.get(neighbor)!) {
          dist.set(neighbor, alt);
          prev.set(neighbor, u);
        }
      }
    }

    if (dist.get(end) === Infinity) return null;

    const path: string[] = [];
    let current: string | null | undefined = end;
    while (current) {
      path.unshift(current);
      current = prev.get(current);
    }

    return { path, distance: dist.get(end)! };
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfsCheck = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      for (const neighbor of this.adjacency.get(node)?.keys() ?? []) {
        if (!visited.has(neighbor) && dfsCheck(neighbor)) return true;
        if (inStack.has(neighbor)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const node of this.adjacency.keys()) {
      if (!visited.has(node) && dfsCheck(node)) return true;
    }
    return false;
  }

  topologicalSort(): string[] | null {
    if (this.hasCycle()) return null;
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (node: string) => {
      visited.add(node);
      for (const neighbor of this.adjacency.get(node)?.keys() ?? []) {
        if (!visited.has(neighbor)) visit(neighbor);
      }
      result.unshift(node);
    };

    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) visit(node);
    }
    return result;
  }

  connectedComponents(): string[][] {
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) {
        const component = this.bfs(node);
        component.forEach((n) => visited.add(n));
        components.push(component);
      }
    }
    return components;
  }
}
