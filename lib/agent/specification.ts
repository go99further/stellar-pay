/**
 * Specification Pattern
 *
 * Inspired by DDD specification patterns:
 * - Composable business rules (and/or/not)
 * - Type-safe predicate composition
 * - Named specifications for readability
 * - Explanation of why a spec fails
 *
 * Pattern: Spec → Compose → Evaluate → Explain
 */

export interface Specification<T> {
  readonly name: string;
  isSatisfiedBy(candidate: T): boolean;
  explain(candidate: T): string[];
  and(other: Specification<T>): Specification<T>;
  or(other: Specification<T>): Specification<T>;
  not(): Specification<T>;
}

abstract class BaseSpec<T> implements Specification<T> {
  abstract readonly name: string;
  abstract isSatisfiedBy(candidate: T): boolean;

  explain(candidate: T): string[] {
    return this.isSatisfiedBy(candidate) ? [] : [`${this.name}: not satisfied`];
  }

  and(other: Specification<T>): Specification<T> {
    return new AndSpec(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpec(this, other);
  }

  not(): Specification<T> {
    return new NotSpec(this);
  }
}

class AndSpec<T> extends BaseSpec<T> {
  readonly name: string;
  constructor(private left: Specification<T>, private right: Specification<T>) {
    super();
    this.name = `(${left.name} AND ${right.name})`;
  }
  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
  override explain(candidate: T): string[] {
    return [...this.left.explain(candidate), ...this.right.explain(candidate)];
  }
}

class OrSpec<T> extends BaseSpec<T> {
  readonly name: string;
  constructor(private left: Specification<T>, private right: Specification<T>) {
    super();
    this.name = `(${left.name} OR ${right.name})`;
  }
  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
  override explain(candidate: T): string[] {
    if (this.isSatisfiedBy(candidate)) return [];
    return [...this.left.explain(candidate), ...this.right.explain(candidate)];
  }
}

class NotSpec<T> extends BaseSpec<T> {
  readonly name: string;
  constructor(private inner: Specification<T>) {
    super();
    this.name = `NOT(${inner.name})`;
  }
  isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
  override explain(candidate: T): string[] {
    return this.isSatisfiedBy(candidate) ? [] : [`${this.name}: not satisfied`];
  }
}

export class PredicateSpec<T> extends BaseSpec<T> {
  constructor(
    readonly name: string,
    private predicate: (candidate: T) => boolean,
    private explanation?: (candidate: T) => string
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.predicate(candidate);
  }

  override explain(candidate: T): string[] {
    if (this.isSatisfiedBy(candidate)) return [];
    return [this.explanation ? this.explanation(candidate) : `${this.name}: not satisfied`];
  }
}

export function spec<T>(
  name: string,
  predicate: (candidate: T) => boolean,
  explanation?: (candidate: T) => string
): Specification<T> {
  return new PredicateSpec(name, predicate, explanation);
}

/**
 * CompositeSpec — all must be satisfied
 */
export function allOf<T>(...specs: Specification<T>[]): Specification<T> {
  return specs.reduce((acc, s) => acc.and(s));
}

/**
 * CompositeSpec — at least one must be satisfied
 */
export function anyOf<T>(...specs: Specification<T>[]): Specification<T> {
  return specs.reduce((acc, s) => acc.or(s));
}

/**
 * SpecificationEvaluator — evaluate and collect all violations
 */
export class SpecificationEvaluator<T> {
  private specs: Specification<T>[] = [];

  add(spec: Specification<T>): this {
    this.specs.push(spec);
    return this;
  }

  evaluate(candidate: T): { valid: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const s of this.specs) {
      violations.push(...s.explain(candidate));
    }
    return { valid: violations.length === 0, violations };
  }
}
