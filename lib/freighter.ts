import {
  isConnected,
  requestAccess,
  getAddress,
} from "@stellar/freighter-api";

/**
 * Check if Freighter extension is installed and available
 */
export async function checkFreighterInstalled(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result.isConnected;
  } catch {
    return false;
  }
}

/**
 * Connect to Freighter wallet — requests access and returns the public key
 */
export async function connectWallet(): Promise<string> {
  // Check if Freighter is installed
  const installed = await checkFreighterInstalled();
  if (!installed) {
    throw new Error(
      "Freighter wallet not found. Please install the Freighter browser extension."
    );
  }

  // Request access (triggers Freighter popup)
  const accessResult = await requestAccess();
  if (accessResult.error) {
    throw new Error(accessResult.error);
  }

  // Get the address
  const addressResult = await getAddress();
  if (addressResult.error) {
    throw new Error(addressResult.error);
  }

  return addressResult.address;
}

/**
 * Get current connected address (does not trigger popup)
 */
export async function getConnectedAddress(): Promise<string | null> {
  try {
    const installed = await checkFreighterInstalled();
    if (!installed) return null;

    const result = await getAddress();
    if (result.error || !result.address) return null;
    return result.address;
  } catch {
    return null;
  }
}
