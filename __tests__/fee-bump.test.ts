import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { submitGaslessSwap } from "../lib/fee-bump";

describe("fee-bump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return hash on successful submission", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "abc123" }),
    });

    const result = await submitGaslessSwap("signed_xdr_here");
    expect(result.hash).toBe("abc123");
  });

  it("should POST to /api/fee-bump with correct body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "xyz" }),
    });

    await submitGaslessSwap("my_signed_xdr");
    expect(mockFetch).toHaveBeenCalledWith("/api/fee-bump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedXdr: "my_signed_xdr" }),
    });
  });

  it("should throw with server error message when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Insufficient fee" }),
    });

    await expect(submitGaslessSwap("bad_xdr")).rejects.toThrow("Insufficient fee");
  });

  it("should throw generic message when error body cannot be parsed", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => { throw new Error("parse error"); },
    });

    await expect(submitGaslessSwap("bad_xdr")).rejects.toThrow("Fee bump request failed");
  });

  it("should throw generic message when error body has no error field", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    await expect(submitGaslessSwap("bad_xdr")).rejects.toThrow("Fee bump failed");
  });
});
