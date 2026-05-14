/**
 * Read-only fallback reader pubkey for unauthenticated demo visitors.
 *
 * Stellar contract reads (getReserves, fetchAmmEvents) require a "source account"
 * to simulate the call against. For read-only operations any valid pubkey works.
 * We use a fixed dummy account so anonymous visitors to the Vercel demo can browse
 * pool stats without connecting Freighter.
 *
 * SECURITY: This pubkey is only used as a simulation source. No private key is
 * involved; no transactions are signed; nothing can be moved from this account.
 */
export const READ_ONLY_READER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

export function getReadOnlyReader(walletAddress: string | null | undefined): string {
  return walletAddress && walletAddress.length > 0 ? walletAddress : READ_ONLY_READER;
}
