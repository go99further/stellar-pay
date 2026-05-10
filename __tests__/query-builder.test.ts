import { describe, it, expect } from "vitest";
import { QueryBuilder, query } from "../lib/agent/query-builder";

describe("QueryBuilder", () => {
  describe("basic SELECT", () => {
    it("should build SELECT * by default", () => {
      const { sql, params } = query("users").build();
      expect(sql).toBe("SELECT * FROM users");
      expect(params).toEqual([]);
    });

    it("should build SELECT with specific columns", () => {
      const { sql } = query("users").select("id", "name", "email").build();
      expect(sql).toBe("SELECT id, name, email FROM users");
    });

    it("should build SELECT DISTINCT", () => {
      const { sql } = query("users").select("country").distinct().build();
      expect(sql).toBe("SELECT DISTINCT country FROM users");
    });

    it("should throw if table not specified", () => {
      expect(() => new QueryBuilder().build()).toThrow(/table not specified/i);
    });
  });

  describe("WHERE clauses", () => {
    it("should add a simple = WHERE clause", () => {
      const { sql, params } = query("users").where("id", "=", 42).build();
      expect(sql).toBe("SELECT * FROM users WHERE id = ?");
      expect(params).toEqual([42]);
    });

    it("should chain multiple WHERE clauses with AND", () => {
      const { sql, params } = query("users")
        .where("active", "=", true)
        .where("age", ">=", 18)
        .build();
      expect(sql).toBe("SELECT * FROM users WHERE active = ? AND age >= ?");
      expect(params).toEqual([true, 18]);
    });

    it("should support OR WHERE", () => {
      const { sql, params } = query("users")
        .where("role", "=", "admin")
        .orWhere("role", "=", "moderator")
        .build();
      expect(sql).toBe("SELECT * FROM users WHERE role = ? OR role = ?");
      expect(params).toEqual(["admin", "moderator"]);
    });

    it("should support LIKE operator", () => {
      const { sql, params } = query("users").where("name", "LIKE", "%john%").build();
      expect(sql).toBe("SELECT * FROM users WHERE name LIKE ?");
      expect(params).toEqual(["%john%"]);
    });

    it("should support != operator", () => {
      const { sql, params } = query("orders").where("status", "!=", "cancelled").build();
      expect(sql).toBe("SELECT * FROM orders WHERE status != ?");
      expect(params).toEqual(["cancelled"]);
    });

    it("should support whereIn", () => {
      const { sql, params } = query("users").whereIn("id", [1, 2, 3]).build();
      expect(sql).toBe("SELECT * FROM users WHERE id IN (?, ?, ?)");
      expect(params).toEqual([1, 2, 3]);
    });

    it("should support whereNotIn", () => {
      const { sql, params } = query("users").whereNotIn("status", ["banned", "deleted"]).build();
      expect(sql).toBe("SELECT * FROM users WHERE status NOT IN (?, ?)");
      expect(params).toEqual(["banned", "deleted"]);
    });

    it("should support whereNull", () => {
      const { sql, params } = query("users").whereNull("deleted_at").build();
      expect(sql).toBe("SELECT * FROM users WHERE deleted_at IS NULL");
      expect(params).toEqual([]);
    });

    it("should support whereNotNull", () => {
      const { sql, params } = query("users").whereNotNull("email_verified_at").build();
      expect(sql).toBe("SELECT * FROM users WHERE email_verified_at IS NOT NULL");
      expect(params).toEqual([]);
    });
  });

  describe("JOINs", () => {
    it("should add INNER JOIN", () => {
      const { sql } = query("orders")
        .select("orders.id", "users.name")
        .join("users", "orders.user_id = users.id")
        .build();
      expect(sql).toBe("SELECT orders.id, users.name FROM orders INNER JOIN users ON orders.user_id = users.id");
    });

    it("should add LEFT JOIN", () => {
      const { sql } = query("users")
        .leftJoin("profiles", "users.id = profiles.user_id")
        .build();
      expect(sql).toContain("LEFT JOIN profiles ON users.id = profiles.user_id");
    });

    it("should add RIGHT JOIN", () => {
      const { sql } = query("users")
        .rightJoin("orders", "users.id = orders.user_id")
        .build();
      expect(sql).toContain("RIGHT JOIN orders ON users.id = orders.user_id");
    });

    it("should support multiple joins", () => {
      const { sql } = query("orders")
        .join("users", "orders.user_id = users.id")
        .leftJoin("coupons", "orders.coupon_id = coupons.id")
        .build();
      expect(sql).toContain("INNER JOIN users");
      expect(sql).toContain("LEFT JOIN coupons");
    });
  });

  describe("ORDER BY", () => {
    it("should add ORDER BY ASC by default", () => {
      const { sql } = query("users").orderBy("name").build();
      expect(sql).toContain("ORDER BY name ASC");
    });

    it("should add ORDER BY DESC", () => {
      const { sql } = query("users").orderBy("created_at", "DESC").build();
      expect(sql).toContain("ORDER BY created_at DESC");
    });

    it("should support multiple ORDER BY columns", () => {
      const { sql } = query("users")
        .orderBy("last_name", "ASC")
        .orderBy("first_name", "ASC")
        .build();
      expect(sql).toContain("ORDER BY last_name ASC, first_name ASC");
    });
  });

  describe("GROUP BY / HAVING", () => {
    it("should add GROUP BY", () => {
      const { sql } = query("orders").select("user_id").groupBy("user_id").build();
      expect(sql).toContain("GROUP BY user_id");
    });

    it("should add HAVING", () => {
      const { sql } = query("orders")
        .select("user_id")
        .groupBy("user_id")
        .having("COUNT(*) > 5")
        .build();
      expect(sql).toContain("HAVING COUNT(*) > 5");
    });
  });

  describe("LIMIT / OFFSET", () => {
    it("should add LIMIT", () => {
      const { sql } = query("users").limit(10).build();
      expect(sql).toContain("LIMIT 10");
    });

    it("should add OFFSET", () => {
      const { sql } = query("users").limit(10).offset(20).build();
      expect(sql).toContain("LIMIT 10");
      expect(sql).toContain("OFFSET 20");
    });
  });

  describe("buildCount", () => {
    it("should build COUNT(*) query", () => {
      const { sql, params } = query("users").where("active", "=", true).buildCount();
      expect(sql).toBe("SELECT COUNT(*) AS count FROM users WHERE active = ?");
      expect(params).toEqual([true]);
    });

    it("should build COUNT(column) query", () => {
      const { sql } = query("users").buildCount("id");
      expect(sql).toBe("SELECT COUNT(id) AS count FROM users");
    });

    it("should not mutate original selects after buildCount", () => {
      const qb = query("users").select("name");
      qb.buildCount();
      const { sql } = qb.build();
      expect(sql).toBe("SELECT name FROM users");
    });
  });

  describe("buildAggregate", () => {
    it("should build SUM query", () => {
      const { sql } = query("orders").buildAggregate("SUM", "amount");
      expect(sql).toBe("SELECT SUM(amount) AS result FROM orders");
    });

    it("should build AVG query", () => {
      const { sql } = query("products").buildAggregate("AVG", "price");
      expect(sql).toBe("SELECT AVG(price) AS result FROM products");
    });

    it("should build MIN/MAX queries", () => {
      expect(query("products").buildAggregate("MIN", "price").sql).toContain("MIN(price)");
      expect(query("products").buildAggregate("MAX", "price").sql).toContain("MAX(price)");
    });

    it("should not mutate original selects after buildAggregate", () => {
      const qb = query("orders").select("user_id");
      qb.buildAggregate("SUM", "amount");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT user_id FROM orders");
    });
  });

  describe("clone", () => {
    it("should produce an independent copy", () => {
      const base = query("users").where("active", "=", true);
      const clone = base.clone().where("role", "=", "admin");

      const { sql: baseSql } = base.build();
      const { sql: cloneSql } = clone.build();

      expect(baseSql).toBe("SELECT * FROM users WHERE active = ?");
      expect(cloneSql).toBe("SELECT * FROM users WHERE active = ? AND role = ?");
    });

    it("should copy limit and offset", () => {
      const base = query("users").limit(5).offset(10);
      const clone = base.clone();
      const { sql } = clone.build();
      expect(sql).toContain("LIMIT 5");
      expect(sql).toContain("OFFSET 10");
    });
  });

  describe("complex queries", () => {
    it("should build a full complex query", () => {
      const { sql, params } = query("orders")
        .select("orders.id", "users.name", "SUM(items.price) AS total")
        .join("users", "orders.user_id = users.id")
        .leftJoin("items", "orders.id = items.order_id")
        .where("orders.status", "!=", "cancelled")
        .whereNotNull("orders.completed_at")
        .groupBy("orders.id", "users.name")
        .having("SUM(items.price) > 100")
        .orderBy("total", "DESC")
        .limit(20)
        .offset(0)
        .build();

      expect(sql).toContain("SELECT orders.id, users.name, SUM(items.price) AS total");
      expect(sql).toContain("FROM orders");
      expect(sql).toContain("INNER JOIN users");
      expect(sql).toContain("LEFT JOIN items");
      expect(sql).toContain("WHERE orders.status != ?");
      expect(sql).toContain("AND orders.completed_at IS NOT NULL");
      expect(sql).toContain("GROUP BY orders.id, users.name");
      expect(sql).toContain("HAVING SUM(items.price) > 100");
      expect(sql).toContain("ORDER BY total DESC");
      expect(sql).toContain("LIMIT 20");
      expect(sql).toContain("OFFSET 0");
      expect(params).toEqual(["cancelled"]);
    });

    it("should correctly parameterize mixed WHERE types", () => {
      const { sql, params } = query("products")
        .whereIn("category_id", [1, 2])
        .where("price", "<", 100)
        .whereNull("deleted_at")
        .build();

      expect(sql).toBe(
        "SELECT * FROM products WHERE category_id IN (?, ?) AND price < ? AND deleted_at IS NULL"
      );
      expect(params).toEqual([1, 2, 100]);
    });
  });
});

describe("QueryBuilder — additional coverage", () => {
  it("should support > operator", () => {
    const { sql, params } = query("orders").where("amount", ">", 50).build();
    expect(sql).toContain("amount > ?");
    expect(params).toContain(50);
  });

  it("should support >= operator", () => {
    const { sql } = query("orders").where("amount", ">=", 100).build();
    expect(sql).toContain("amount >= ?");
  });

  it("should support <= operator", () => {
    const { sql } = query("orders").where("amount", "<=", 200).build();
    expect(sql).toContain("amount <= ?");
  });

  it("should support < operator", () => {
    const { sql } = query("orders").where("amount", "<", 10).build();
    expect(sql).toContain("amount < ?");
  });

  it("clone should be independent from original", () => {
    const base = query("users").limit(5);
    const clone = base.clone();
    clone.where("active", "=", true);
    const { sql: baseSql } = base.build();
    const { sql: cloneSql } = clone.build();
    expect(baseSql).not.toContain("WHERE");
    expect(cloneSql).toContain("WHERE");
  });

  it("buildAggregate should build AVG query", () => {
    const { sql } = query("orders").buildAggregate("AVG", "amount");
    expect(sql).toContain("AVG(amount)");
  });

  it("buildAggregate should build MIN query", () => {
    const { sql } = query("orders").buildAggregate("MIN", "price");
    expect(sql).toContain("MIN(price)");
  });

  it("buildAggregate should build MAX query", () => {
    const { sql } = query("orders").buildAggregate("MAX", "price");
    expect(sql).toContain("MAX(price)");
  });
});
