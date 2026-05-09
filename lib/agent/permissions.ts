export interface TransactionPermissionContext {
  readonly maxSwapAmount: number;
  readonly allowedTokens: readonly string[];
  readonly denyOperations: readonly string[];
}

export const DEFAULT_PERMISSION_CONTEXT: TransactionPermissionContext = {
  maxSwapAmount: 100_000,
  allowedTokens: ["TKNA", "TKNB"],
  denyOperations: [],
};

export function isOperationAllowed(
  ctx: TransactionPermissionContext,
  operation: string
): boolean {
  return !ctx.denyOperations.includes(operation);
}

export function isAmountAllowed(
  ctx: TransactionPermissionContext,
  amount: number
): boolean {
  return amount <= ctx.maxSwapAmount;
}

export function isTokenAllowed(
  ctx: TransactionPermissionContext,
  token: string
): boolean {
  return ctx.allowedTokens.includes(token);
}
