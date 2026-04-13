"use client";

import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";

let initialized = false;

/**
 * Initialize the StellarWalletsKit (call once)
 */
export function initWalletKit() {
  if (initialized) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new LobstrModule(),
    ],
  });
  initialized = true;
}

/**
 * Open the wallet auth modal and return the connected address
 */
export async function connectWithKit(): Promise<string> {
  initWalletKit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

/**
 * Sign a transaction using the connected wallet
 */
export async function signWithKit(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string }
): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, opts);
  return signedTxXdr;
}

/**
 * Disconnect the current wallet
 */
export async function disconnectKit(): Promise<void> {
  await StellarWalletsKit.disconnect();
}
