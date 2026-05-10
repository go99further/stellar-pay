/**
 * Query Builder
 *
 * Inspired by production ORM patterns (Knex/Prisma/TypeORM):
 * - Fluent API for building queries
 * - Parameterized queries (SQL injection safe)
 * - Join, where, order, limit/offset
 * - Aggregate functions
 * - Query plan inspection
 *
 * Pattern: Select → From → Join → Where → Order → Limit → Build
 */

export type WhereOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "LIKE" | "IN" | "NOT IN" | "IS NULL" | "IS NOT NULL";
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
export type OrderDirection = "ASC" | "DESC";
export type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

export interface WhereClause {
  column: string;
  operator: WhereOperator;
  value?: unknown;
  conjunction: "AND" | "OR";
}

export interface JoinClause {
  type: JoinType;
  table: string;
  on: string;
}

export interface OrderClause {
  column: string;
  direction: OrderDirection;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Query Builder
 * Fluent, parameterized SQL query builder
 */
export class QueryBuilder {
  private _table = "";
  private _selects: string[] = [];
  private _wheres: WhereClause[] = [];
  private _joins: JoinClause[] = [];
  private _orders: OrderClause[] = [];
  private _groupBy: string[] = [];
  private _having: string[] = [];
  private _limit?: number;
  private _offset?: number;
  private _distinct = false;

  /**
   * Set the table
   */
  from(table: string): this {
    this._table = table;
    return this;
  }

  /**
   * Select columns
   */
  select(...columns: string[]): this {
    this._selects.push(...columns);
    return this;
  }

  /**
   * Select distinct
   */
  distinct(): this {
    this._distinct = true;
    return this;
  }

  /**
   * Add WHERE clause
   */
  where(column: string, operator: WhereOperator, value?: unknown): this {
    this._wheres.push({ column, operator, value, conjunction: "AND" });
    return this;
  }

  /**
   * Add OR WHERE clause
   */
  orWhere(column: string, operator: WhereOperator, value?: unknown): this {
    this._wheres.push({ column, operator, value, conjunction: "OR" });
    return this;
  }

  /**
   * Add WHERE IN clause
   */
  whereIn(column: string, values: unknown[]): this {
    this._wheres.push({ column, operator: "IN", value: values, conjunction: "AND" });
    return this;
  }

  /**
   * Add WHERE NOT IN clause
   */
  whereNotIn(column: string, values: unknown[]): this {
    this._wheres.push({ column, operator: "NOT IN", value: values, conjunction: "AND" });
    return this;
  }

  /**
   * Add WHERE NULL clause
   */
  whereNull(column: string): this {
    this._wheres.push({ column, operator: "IS NULL", conjunction: "AND" });
    return this;
  }

  /**
   * Add WHERE NOT NULL clause
   */
  whereNotNull(column: string): this {
    this._wheres.push({ column, operator: "IS NOT NULL", conjunction: "AND" });
    return this;
  }

  /**
   * Add JOIN clause
   */
  join(table: string, on: string, type: JoinType = "INNER"): this {
    this._joins.push({ type, table, on });
    return this;
  }

  leftJoin(table: string, on: string): this {
    return this.join(table, on, "LEFT");
  }

  rightJoin(table: string, on: string): this {
    return this.join(table, on, "RIGHT");
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(column: string, direction: OrderDirection = "ASC"): this {
    this._orders.push({ column, direction });
    return this;
  }

  /**
   * Add GROUP BY clause
   */
  groupBy(...columns: string[]): this {
    this._groupBy.push(...columns);
    return this;
  }

  /**
   * Add HAVING clause (raw)
   */
  having(clause: string): this {
    this._having.push(clause);
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Build SELECT query
   */
  build(): BuiltQuery {
    if (!this._table) throw new Error("Table not specified — call .from()");

    const params: unknown[] = [];
    const parts: string[] = [];

    // SELECT
    const cols = this._selects.length > 0 ? this._selects.join(", ") : "*";
    parts.push(`SELECT ${this._distinct ? "DISTINCT " : ""}${cols}`);

    // FROM
    parts.push(`FROM ${this._table}`);

    // JOINs
    for (const join of this._joins) {
      parts.push(`${join.type} JOIN ${join.table} ON ${join.on}`);
    }

    // WHERE
    if (this._wheres.length > 0) {
      const whereParts = this._wheres.map((w, i) => {
        const prefix = i === 0 ? "" : `${w.conjunction} `;
        if (w.operator === "IS NULL" || w.operator === "IS NOT NULL") {
          return `${prefix}${w.column} ${w.operator}`;
        }
        if (w.operator === "IN" || w.operator === "NOT IN") {
          const arr = w.value as unknown[];
          const placeholders = arr.map(() => { params.push(undefined); return `?`; });
          // Replace last N params with actual values
          const start = params.length - arr.length;
          for (let j = 0; j < arr.length; j++) params[start + j] = arr[j];
          return `${prefix}${w.column} ${w.operator} (${placeholders.join(", ")})`;
        }
        params.push(w.value);
        return `${prefix}${w.column} ${w.operator} ?`;
      });
      parts.push(`WHERE ${whereParts.join(" ")}`);
    }

    // GROUP BY
    if (this._groupBy.length > 0) {
      parts.push(`GROUP BY ${this._groupBy.join(", ")}`);
    }

    // HAVING
    if (this._having.length > 0) {
      parts.push(`HAVING ${this._having.join(" AND ")}`);
    }

    // ORDER BY
    if (this._orders.length > 0) {
      const orderParts = this._orders.map((o) => `${o.column} ${o.direction}`);
      parts.push(`ORDER BY ${orderParts.join(", ")}`);
    }

    // LIMIT / OFFSET
    if (this._limit !== undefined) {
      parts.push(`LIMIT ${this._limit}`);
    }
    if (this._offset !== undefined) {
      parts.push(`OFFSET ${this._offset}`);
    }

    return { sql: parts.join(" "), params };
  }

  /**
   * Build COUNT query
   */
  buildCount(column = "*"): BuiltQuery {
    const original = [...this._selects];
    this._selects = [`COUNT(${column}) AS count`];
    const result = this.build();
    this._selects = original;
    return result;
  }

  /**
   * Build aggregate query
   */
  buildAggregate(fn: AggregateFunction, column: string): BuiltQuery {
    const original = [...this._selects];
    this._selects = [`${fn}(${column}) AS result`];
    const result = this.build();
    this._selects = original;
    return result;
  }

  /**
   * Clone the builder
   */
  clone(): QueryBuilder {
    const q = new QueryBuilder();
    q._table = this._table;
    q._selects = [...this._selects];
    q._wheres = [...this._wheres];
    q._joins = [...this._joins];
    q._orders = [...this._orders];
    q._groupBy = [...this._groupBy];
    q._having = [...this._having];
    q._limit = this._limit;
    q._offset = this._offset;
    q._distinct = this._distinct;
    return q;
  }
}

/**
 * Factory helper
 */
export function query(table: string): QueryBuilder {
  return new QueryBuilder().from(table);
}
