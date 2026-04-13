"use client";

import { useState, useCallback, useEffect } from "react";
import {
  readPollQuestion,
  readPollOptions,
  readPollVotes,
  readTotalVotes,
  checkHasVoted,
  buildVoteTransaction,
  submitTransaction,
  getContractId,
} from "@/lib/poll-contract";
import { useWallet } from "@/context/WalletContext";
import { classifyError } from "@/lib/errors";

export interface PollData {
  question: string;
  options: string[];
  votes: Map<number, number>;
  totalVotes: number;
  hasVoted: boolean;
  isLoading: boolean;
  contractId: string;
}

export type TxStatus = "idle" | "building" | "signing" | "submitting" | "success" | "error";

export function usePollContract() {
  const { address, signTransaction } = useWallet();
  const [pollData, setPollData] = useState<PollData>({
    question: "",
    options: [],
    votes: new Map(),
    totalVotes: 0,
    hasVoted: false,
    isLoading: true,
    contractId: getContractId(),
  });
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<Error | null>(null);

  const loadPollData = useCallback(async () => {
    if (!address || !getContractId()) {
      setPollData((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      const [question, options, votes, totalVotes, hasVoted] = await Promise.all([
        readPollQuestion(address),
        readPollOptions(address),
        readPollVotes(address),
        readTotalVotes(address),
        checkHasVoted(address, address),
      ]);

      setPollData({
        question,
        options,
        votes,
        totalVotes,
        hasVoted,
        isLoading: false,
        contractId: getContractId(),
      });
    } catch {
      setPollData((prev) => ({ ...prev, isLoading: false }));
    }
  }, [address]);

  // Load poll data when address changes
  useEffect(() => {
    loadPollData();
  }, [loadPollData]);

  // Vote function
  const vote = useCallback(
    async (optionIndex: number) => {
      if (!address) return;

      setTxStatus("building");
      setTxHash(null);
      setTxError(null);

      try {
        // Build the transaction
        const xdr = await buildVoteTransaction(address, optionIndex);

        // Sign with wallet
        setTxStatus("signing");
        const signedXdr = await signTransaction(xdr);

        // Submit
        setTxStatus("submitting");
        const result = await submitTransaction(signedXdr);

        setTxHash(result.hash);
        setTxStatus("success");

        // Reload poll data
        await loadPollData();
      } catch (err) {
        setTxError(classifyError(err));
        setTxStatus("error");
      }
    },
    [address, signTransaction, loadPollData]
  );

  const resetTx = useCallback(() => {
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
  }, []);

  return {
    pollData,
    txStatus,
    txHash,
    txError,
    vote,
    resetTx,
    refreshPoll: loadPollData,
  };
}
