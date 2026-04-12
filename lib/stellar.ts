import * as StellarSdk from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

/**
 * Fetch XLM balance for a given public key
 */
export async function fetchBalance(publicKey: string): Promise<string> {
  const account = await server.loadAccount(publicKey);
  const native = account.balances.find(
    (b: StellarSdk.Horizon.HorizonApi.BalanceLine) => b.asset_type === "native"
  );
  return native ? native.balance : "0";
}

/**
 * Send XLM payment from one account to another on testnet
 * Uses Freighter wallet for signing
 */
export async function sendPayment(
  senderPublicKey: string,
  destinationAddress: string,
  amount: string
): Promise<string> {
  // Load sender account from Horizon
  const sourceAccount = await server.loadAccount(senderPublicKey);

  // Build the transaction
  const fee = await server.fetchBaseFee();
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: fee.toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destinationAddress,
        asset: StellarSdk.Asset.native(),
        amount: amount,
      })
    )
    .setTimeout(60)
    .build();

  // Sign with Freighter
  const signResult = await signTransaction(transaction.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (signResult.error) {
    throw new Error(signResult.error);
  }

  // Rebuild signed transaction and submit
  const signedTransaction = StellarSdk.TransactionBuilder.fromXDR(
    signResult.signedTxXdr,
    NETWORK_PASSPHRASE
  );

  const result = await server.submitTransaction(signedTransaction);
  return result.hash;
}

/**
 * Fund an account on testnet using Friendbot
 */
export async function fundWithFriendbot(publicKey: string): Promise<boolean> {
  const response = await fetch(
    `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`
  );
  return response.ok;
}
