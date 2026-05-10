/**
 * Transaction Builder
 *
 * Stellar SDK wrapper for building transactions:
 * - Type-safe transaction building
 * - Automatic fee calculation
 * - Time bounds management
 * - Multi-operation support
 *
 * Pattern: Build → Sign → Submit
 */

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Server,
  Transaction,
  TransactionBuilder as StellarTxBuilder,
  BASE_FEE,
  Memo,
} from "@stellar/stellar-sdk";

export interface TransactionConfig {
  networkPassphrase: string;
  horizonUrl: string;
  baseFee: string;
  timeout: number; // seconds
}

export interface BuildTransactionParams {
  sourceAddress: string;
  operations: Operation[];
  memo?: string;
  timeBounds?: {
    minTime?: number;
    maxTime?: number;
  };
}

export interface SignedTransaction {
  xdr: string;
  hash: string;
  networkPassphrase: string;
}

export interface SubmitResult {
  successful: boolean;
  hash: string;
  ledger?: number;
  error?: string;
}

/**
 * Transaction Builder
 * Simplifies Stellar transaction building and submission
 */
export class TransactionBuilder {
  private config: TransactionConfig;
  private server: Server;

  constructor(config: Partial<TransactionConfig> = {}) {
    this.config = {
      networkPassphrase: Networks.TESTNET,
      horizonUrl: "https://horizon-testnet.stellar.org",
      baseFee: BASE_FEE,
      timeout: 300, // 5 minutes
      ...config,
    };

    this.server = new Server(this.config.horizonUrl);
  }

  /**
   * Build a transaction
   */
  async buildTransaction(params: BuildTransactionParams): Promise<Transaction> {
    // Load source account
    const account = await this.loadAccount(params.sourceAddress);

    // Create transaction builder
    const builder = new StellarTxBuilder(account, {
      fee: this.config.baseFee,
      networkPassphrase: this.config.networkPassphrase,
    });

    // Add operations
    for (const operation of params.operations) {
      builder.addOperation(operation);
    }

    // Add memo if provided
    if (params.memo) {
      builder.addMemo(Memo.text(params.memo));
    }

    // Set time bounds
    const now = Math.floor(Date.now() / 1000);
    const minTime = params.timeBounds?.minTime || 0;
    const maxTime = params.timeBounds?.maxTime || now + this.config.timeout;

    builder.setTimeout(maxTime - now);

    // Build transaction
    return builder.build();
  }

  /**
   * Build swap transaction
   */
  async buildSwapTransaction(
    userAddress: string,
    contractId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<Transaction> {
    // Create invoke contract operation
    const operation = Operation.invokeContractFunction({
      contract: contractId,
      function: "swap",
      args: [
        // Convert to Stellar SDK types
        this.addressToScVal(userAddress),
        this.addressToScVal(tokenIn),
        this.addressToScVal(tokenOut),
        this.i128ToScVal(amountIn),
        this.i128ToScVal(minAmountOut),
      ],
    });

    return this.buildTransaction({
      sourceAddress: userAddress,
      operations: [operation],
      memo: `Swap ${amountIn} ${tokenIn} for ${tokenOut}`,
    });
  }

  /**
   * Build add liquidity transaction
   */
  async buildAddLiquidityTransaction(
    userAddress: string,
    contractId: string,
    tokenA: string,
    tokenB: string,
    amountA: bigint,
    amountB: bigint,
    minLpTokens: bigint
  ): Promise<Transaction> {
    const operation = Operation.invokeContractFunction({
      contract: contractId,
      function: "add_liquidity",
      args: [
        this.addressToScVal(userAddress),
        this.addressToScVal(tokenA),
        this.addressToScVal(tokenB),
        this.i128ToScVal(amountA),
        this.i128ToScVal(amountB),
        this.i128ToScVal(minLpTokens),
      ],
    });

    return this.buildTransaction({
      sourceAddress: userAddress,
      operations: [operation],
      memo: `Add liquidity ${amountA} ${tokenA} + ${amountB} ${tokenB}`,
    });
  }

  /**
   * Build remove liquidity transaction
   */
  async buildRemoveLiquidityTransaction(
    userAddress: string,
    contractId: string,
    lpTokenAmount: bigint,
    minAmountA: bigint,
    minAmountB: bigint
  ): Promise<Transaction> {
    const operation = Operation.invokeContractFunction({
      contract: contractId,
      function: "remove_liquidity",
      args: [
        this.addressToScVal(userAddress),
        this.i128ToScVal(lpTokenAmount),
        this.i128ToScVal(minAmountA),
        this.i128ToScVal(minAmountB),
      ],
    });

    return this.buildTransaction({
      sourceAddress: userAddress,
      operations: [operation],
      memo: `Remove liquidity ${lpTokenAmount} LP tokens`,
    });
  }

  /**
   * Sign transaction
   */
  signTransaction(transaction: Transaction, secretKey: string): SignedTransaction {
    const keypair = Keypair.fromSecret(secretKey);
    transaction.sign(keypair);

    return {
      xdr: transaction.toXDR(),
      hash: transaction.hash().toString("hex"),
      networkPassphrase: this.config.networkPassphrase,
    };
  }

  /**
   * Submit signed transaction
   */
  async submitTransaction(signedXdr: string): Promise<SubmitResult> {
    try {
      const transaction = new Transaction(signedXdr, this.config.networkPassphrase);
      const response = await this.server.submitTransaction(transaction);

      return {
        successful: response.successful,
        hash: response.hash,
        ledger: response.ledger,
      };
    } catch (error) {
      return {
        successful: false,
        hash: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate transaction (dry run)
   */
  async simulateTransaction(transaction: Transaction): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }> {
    try {
      const response = await this.server.simulateTransaction(transaction);

      return {
        success: true,
        result: response,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get transaction fee estimate
   */
  async estimateFee(transaction: Transaction): Promise<string> {
    try {
      const response = await this.server.simulateTransaction(transaction);
      return response.minResourceFee || this.config.baseFee;
    } catch {
      return this.config.baseFee;
    }
  }

  /**
   * Load account from network
   */
  private async loadAccount(address: string): Promise<Account> {
    return this.server.loadAccount(address);
  }

  /**
   * Convert address to ScVal (Stellar Contract Value)
   */
  private addressToScVal(address: string): unknown {
    // Stub: In real implementation, use xdr.ScVal.scvAddress()
    return { type: "address", value: address };
  }

  /**
   * Convert i128 to ScVal
   */
  private i128ToScVal(value: bigint): unknown {
    // Stub: In real implementation, use xdr.ScVal.scvI128()
    return { type: "i128", value: value.toString() };
  }

  /**
   * Get network info
   */
  getNetworkInfo(): {
    networkPassphrase: string;
    horizonUrl: string;
    isTestnet: boolean;
  } {
    return {
      networkPassphrase: this.config.networkPassphrase,
      horizonUrl: this.config.horizonUrl,
      isTestnet: this.config.networkPassphrase === Networks.TESTNET,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TransactionConfig>): void {
    this.config = { ...this.config, ...config };
    this.server = new Server(this.config.horizonUrl);
  }
}

/**
 * Global transaction builder instance (testnet)
 */
export const transactionBuilder = new TransactionBuilder();

/**
 * Create mainnet transaction builder
 */
export function createMainnetBuilder(): TransactionBuilder {
  return new TransactionBuilder({
    networkPassphrase: Networks.PUBLIC,
    horizonUrl: "https://horizon.stellar.org",
  });
}

/**
 * Usage example:
 *
 * // Build swap transaction
 * const tx = await transactionBuilder.buildSwapTransaction(
 *   "GXXXXXX...",
 *   "CDXQV5KJC2LGTCW7LKLEQKSHLEE4ODUGSEBOBRB6YVDIY73YEMCLOLSN",
 *   "CBWYMSLBEJDFVH4QIYV7VX2W26JWVEPMC7FU4PZPS5H62SUJKJ7V4TV2",
 *   "CCOTCYJNSVFPNLCH3CASXSDM7IGFG23HB4PDSNZNKUUCUBLVQY3V5XTR",
 *   100n * 10n ** 7n,
 *   95n * 10n ** 7n
 * );
 *
 * // Simulate first
 * const simulation = await transactionBuilder.simulateTransaction(tx);
 * console.log("Simulation:", simulation);
 *
 * // Sign (in real app, user signs via Freighter)
 * const signed = transactionBuilder.signTransaction(tx, "SXXXXXX...");
 *
 * // Submit
 * const result = await transactionBuilder.submitTransaction(signed.xdr);
 * console.log("Result:", result);
 */
