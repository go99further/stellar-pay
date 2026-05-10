import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
}));

import {
  checkFreighterInstalled,
  connectWallet,
  getConnectedAddress,
} from "../lib/freighter";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";

describe("freighter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkFreighterInstalled", () => {
    it("should return true when Freighter is connected", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      expect(await checkFreighterInstalled()).toBe(true);
    });

    it("should return false when Freighter is not connected", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: false } as never);
      expect(await checkFreighterInstalled()).toBe(false);
    });

    it("should return false when isConnected throws", async () => {
      vi.mocked(isConnected).mockRejectedValue(new Error("extension not found"));
      expect(await checkFreighterInstalled()).toBe(false);
    });
  });

  describe("connectWallet", () => {
    it("should return address on successful connection", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(requestAccess).mockResolvedValue({ error: undefined } as never);
      vi.mocked(getAddress).mockResolvedValue({ address: "GPUBKEY123", error: undefined } as never);

      const address = await connectWallet();
      expect(address).toBe("GPUBKEY123");
    });

    it("should throw when Freighter is not installed", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: false } as never);
      await expect(connectWallet()).rejects.toThrow(/Freighter wallet not found/);
    });

    it("should throw when requestAccess returns error", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(requestAccess).mockResolvedValue({ error: "User rejected" } as never);
      await expect(connectWallet()).rejects.toThrow("User rejected");
    });

    it("should throw when getAddress returns error", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(requestAccess).mockResolvedValue({ error: undefined } as never);
      vi.mocked(getAddress).mockResolvedValue({ address: "", error: "No address" } as never);
      await expect(connectWallet()).rejects.toThrow("No address");
    });
  });

  describe("getConnectedAddress", () => {
    it("should return address when connected", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(getAddress).mockResolvedValue({ address: "GPUBKEY456", error: undefined } as never);

      const address = await getConnectedAddress();
      expect(address).toBe("GPUBKEY456");
    });

    it("should return null when Freighter is not installed", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: false } as never);
      expect(await getConnectedAddress()).toBeNull();
    });

    it("should return null when getAddress returns error", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(getAddress).mockResolvedValue({ address: "", error: "locked" } as never);
      expect(await getConnectedAddress()).toBeNull();
    });

    it("should return null when getAddress returns empty address", async () => {
      vi.mocked(isConnected).mockResolvedValue({ isConnected: true } as never);
      vi.mocked(getAddress).mockResolvedValue({ address: "", error: undefined } as never);
      expect(await getConnectedAddress()).toBeNull();
    });

    it("should return null when an exception is thrown", async () => {
      vi.mocked(isConnected).mockRejectedValue(new Error("crash"));
      expect(await getConnectedAddress()).toBeNull();
    });
  });
});
