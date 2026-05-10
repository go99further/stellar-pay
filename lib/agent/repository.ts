/**
 * Repository Pattern
 *
 * Inspired by DDD repository patterns:
 * - Generic CRUD operations
 * - Query by specification
 * - Pagination and sorting
 * - In-memory implementation (test-friendly)
 * - Unit of Work integration
 *
 * Pattern: Entity → Repository → Query → Persist → Retrieve
 */

export interface Entity {
  id: string;
}

export interface PageOptions {
  page: number;   // 1-based
  pageSize: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SortOptions<T> {
  field: keyof T;
  direction: "asc" | "desc";
}

export interface Repository<T extends Entity> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  findBy(predicate: (entity: T) => boolean): Promise<T[]>;
  findOne(predicate: (entity: T) => boolean): Promise<T | null>;
  save(entity: T): Promise<T>;
  saveAll(entities: T[]): Promise<T[]>;
  delete(id: string): Promise<boolean>;
  deleteBy(predicate: (entity: T) => boolean): Promise<number>;
  count(): Promise<number>;
  exists(id: string): Promise<boolean>;
  paginate(options: PageOptions, predicate?: (entity: T) => boolean, sort?: SortOptions<T>): Promise<PageResult<T>>;
}

export class InMemoryRepository<T extends Entity> implements Repository<T> {
  protected store: Map<string, T> = new Map();

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(): Promise<T[]> {
    return [...this.store.values()];
  }

  async findBy(predicate: (entity: T) => boolean): Promise<T[]> {
    return [...this.store.values()].filter(predicate);
  }

  async findOne(predicate: (entity: T) => boolean): Promise<T | null> {
    return [...this.store.values()].find(predicate) ?? null;
  }

  async save(entity: T): Promise<T> {
    this.store.set(entity.id, { ...entity });
    return entity;
  }

  async saveAll(entities: T[]): Promise<T[]> {
    for (const e of entities) await this.save(e);
    return entities;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async deleteBy(predicate: (entity: T) => boolean): Promise<number> {
    let count = 0;
    for (const [id, entity] of this.store.entries()) {
      if (predicate(entity)) { this.store.delete(id); count++; }
    }
    return count;
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async paginate(
    options: PageOptions,
    predicate?: (entity: T) => boolean,
    sort?: SortOptions<T>
  ): Promise<PageResult<T>> {
    let items = [...this.store.values()];
    if (predicate) items = items.filter(predicate);

    if (sort) {
      items.sort((a, b) => {
        const av = a[sort.field];
        const bv = b[sort.field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }

    const total = items.length;
    const totalPages = Math.ceil(total / options.pageSize);
    const start = (options.page - 1) * options.pageSize;
    const pageItems = items.slice(start, start + options.pageSize);

    return { items: pageItems, total, page: options.page, pageSize: options.pageSize, totalPages };
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Unit of Work — tracks changes and commits atomically
 */
export class UnitOfWork<T extends Entity> {
  private added: T[] = [];
  private updated: T[] = [];
  private deletedIds: string[] = [];

  constructor(private repo: InMemoryRepository<T>) {}

  add(entity: T): this {
    this.added.push(entity);
    return this;
  }

  update(entity: T): this {
    this.updated.push(entity);
    return this;
  }

  remove(id: string): this {
    this.deletedIds.push(id);
    return this;
  }

  async commit(): Promise<void> {
    for (const e of this.added) await this.repo.save(e);
    for (const e of this.updated) await this.repo.save(e);
    for (const id of this.deletedIds) await this.repo.delete(id);
    this.clear();
  }

  rollback(): void {
    this.clear();
  }

  private clear(): void {
    this.added = [];
    this.updated = [];
    this.deletedIds = [];
  }

  getPendingCount(): number {
    return this.added.length + this.updated.length + this.deletedIds.length;
  }
}
