import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRepository, UnitOfWork } from "../lib/agent/repository";
import type { Entity } from "../lib/agent/repository";

interface User extends Entity {
  id: string;
  name: string;
  age: number;
  active: boolean;
}

function makeUser(id: string, name: string, age = 25, active = true): User {
  return { id, name, age, active };
}

describe("InMemoryRepository", () => {
  let repo: InMemoryRepository<User>;

  beforeEach(() => {
    repo = new InMemoryRepository<User>();
  });

  describe("save / findById", () => {
    it("should save and retrieve an entity", async () => {
      await repo.save(makeUser("1", "Alice"));
      const found = await repo.findById("1");
      expect(found?.name).toBe("Alice");
    });

    it("should return null for missing id", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });

    it("should overwrite on re-save", async () => {
      await repo.save(makeUser("1", "Alice"));
      await repo.save(makeUser("1", "Alice Updated"));
      const found = await repo.findById("1");
      expect(found?.name).toBe("Alice Updated");
    });

    it("should store a copy (not reference)", async () => {
      const user = makeUser("1", "Alice");
      await repo.save(user);
      user.name = "Mutated";
      const found = await repo.findById("1");
      expect(found?.name).toBe("Alice");
    });
  });

  describe("findAll", () => {
    it("should return all entities", async () => {
      await repo.save(makeUser("1", "Alice"));
      await repo.save(makeUser("2", "Bob"));
      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it("should return empty array when empty", async () => {
      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe("findBy", () => {
    it("should filter by predicate", async () => {
      await repo.save(makeUser("1", "Alice", 30, true));
      await repo.save(makeUser("2", "Bob", 20, false));
      await repo.save(makeUser("3", "Carol", 25, true));

      const active = await repo.findBy((u) => u.active);
      expect(active).toHaveLength(2);
      expect(active.map((u) => u.name).sort()).toEqual(["Alice", "Carol"]);
    });

    it("should return empty array when none match", async () => {
      await repo.save(makeUser("1", "Alice"));
      const result = await repo.findBy((u) => u.age > 100);
      expect(result).toEqual([]);
    });
  });

  describe("findOne", () => {
    it("should return first matching entity", async () => {
      await repo.save(makeUser("1", "Alice", 30));
      await repo.save(makeUser("2", "Bob", 25));
      const found = await repo.findOne((u) => u.age === 30);
      expect(found?.name).toBe("Alice");
    });

    it("should return null when none match", async () => {
      await repo.save(makeUser("1", "Alice"));
      expect(await repo.findOne((u) => u.age > 100)).toBeNull();
    });
  });

  describe("saveAll", () => {
    it("should save multiple entities", async () => {
      await repo.saveAll([makeUser("1", "Alice"), makeUser("2", "Bob"), makeUser("3", "Carol")]);
      expect(await repo.count()).toBe(3);
    });
  });

  describe("delete", () => {
    it("should delete by id", async () => {
      await repo.save(makeUser("1", "Alice"));
      const deleted = await repo.delete("1");
      expect(deleted).toBe(true);
      expect(await repo.findById("1")).toBeNull();
    });

    it("should return false for missing id", async () => {
      expect(await repo.delete("missing")).toBe(false);
    });
  });

  describe("deleteBy", () => {
    it("should delete all matching entities", async () => {
      await repo.save(makeUser("1", "Alice", 30, false));
      await repo.save(makeUser("2", "Bob", 25, true));
      await repo.save(makeUser("3", "Carol", 20, false));

      const count = await repo.deleteBy((u) => !u.active);
      expect(count).toBe(2);
      expect(await repo.count()).toBe(1);
    });

    it("should return 0 when none match", async () => {
      await repo.save(makeUser("1", "Alice"));
      expect(await repo.deleteBy((u) => u.age > 100)).toBe(0);
    });
  });

  describe("count / exists", () => {
    it("should count entities", async () => {
      await repo.save(makeUser("1", "Alice"));
      await repo.save(makeUser("2", "Bob"));
      expect(await repo.count()).toBe(2);
    });

    it("should return true for existing id", async () => {
      await repo.save(makeUser("1", "Alice"));
      expect(await repo.exists("1")).toBe(true);
    });

    it("should return false for missing id", async () => {
      expect(await repo.exists("missing")).toBe(false);
    });
  });

  describe("paginate", () => {
    beforeEach(async () => {
      await repo.saveAll([
        makeUser("1", "Alice", 30),
        makeUser("2", "Bob", 25),
        makeUser("3", "Carol", 35),
        makeUser("4", "Dave", 20),
        makeUser("5", "Eve", 28),
      ]);
    });

    it("should return first page", async () => {
      const result = await repo.paginate({ page: 1, pageSize: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.page).toBe(1);
    });

    it("should return last page with fewer items", async () => {
      const result = await repo.paginate({ page: 3, pageSize: 2 });
      expect(result.items).toHaveLength(1);
    });

    it("should filter with predicate", async () => {
      const result = await repo.paginate({ page: 1, pageSize: 10 }, (u) => u.age >= 28);
      expect(result.total).toBe(3);
      expect(result.items.map((u) => u.name).sort()).toEqual(["Alice", "Carol", "Eve"]);
    });

    it("should sort ascending", async () => {
      const result = await repo.paginate(
        { page: 1, pageSize: 5 },
        undefined,
        { field: "age", direction: "asc" }
      );
      const ages = result.items.map((u) => u.age);
      expect(ages).toEqual([20, 25, 28, 30, 35]);
    });

    it("should sort descending", async () => {
      const result = await repo.paginate(
        { page: 1, pageSize: 5 },
        undefined,
        { field: "name", direction: "desc" }
      );
      const names = result.items.map((u) => u.name);
      expect(names[0]).toBe("Eve");
    });

    it("should return empty page beyond total", async () => {
      const result = await repo.paginate({ page: 10, pageSize: 2 });
      expect(result.items).toHaveLength(0);
    });
  });
});

describe("UnitOfWork", () => {
  let repo: InMemoryRepository<User>;
  let uow: UnitOfWork<User>;

  beforeEach(() => {
    repo = new InMemoryRepository<User>();
    uow = new UnitOfWork(repo);
  });

  it("should commit added entities", async () => {
    uow.add(makeUser("1", "Alice"));
    uow.add(makeUser("2", "Bob"));
    await uow.commit();
    expect(await repo.count()).toBe(2);
  });

  it("should commit updated entities", async () => {
    await repo.save(makeUser("1", "Alice"));
    uow.update(makeUser("1", "Alice Updated"));
    await uow.commit();
    const found = await repo.findById("1");
    expect(found?.name).toBe("Alice Updated");
  });

  it("should commit deletions", async () => {
    await repo.save(makeUser("1", "Alice"));
    uow.remove("1");
    await uow.commit();
    expect(await repo.exists("1")).toBe(false);
  });

  it("should rollback without persisting", async () => {
    uow.add(makeUser("1", "Alice"));
    uow.rollback();
    await uow.commit(); // nothing to commit
    expect(await repo.count()).toBe(0);
  });

  it("should clear pending after commit", async () => {
    uow.add(makeUser("1", "Alice"));
    expect(uow.getPendingCount()).toBe(1);
    await uow.commit();
    expect(uow.getPendingCount()).toBe(0);
  });

  it("should track pending count", () => {
    uow.add(makeUser("1", "Alice"));
    uow.update(makeUser("2", "Bob"));
    uow.remove("3");
    expect(uow.getPendingCount()).toBe(3);
  });

  it("should handle mixed operations in one commit", async () => {
    await repo.save(makeUser("existing", "Old"));
    uow.add(makeUser("new", "New"));
    uow.update(makeUser("existing", "Updated"));
    uow.remove("existing");
    await uow.commit();

    expect(await repo.exists("new")).toBe(true);
    expect(await repo.exists("existing")).toBe(false);
  });
});
