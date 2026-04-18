/**
 * Client-side helper for gasless (fee-bumped) AMM transactions.
 * Sends the signed inner XDR to the server-side fee bump sponsor endpoint.
 */
export async function submitGaslessSwap(signedXdr: string): Promise<{ hash: string }> {
  const res = await fetch("/api/fee-bump", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedXdr }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Fee bump request failed" }));
    throw new Error(err.error || "Fee bump failed");
  }

  return res.json();
}
