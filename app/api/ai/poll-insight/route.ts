import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { question, options, votes, totalVotes } = await req.json();

    if (!question || !Array.isArray(options) || options.length === 0) {
      return NextResponse.json({ insight: "" }, { status: 400 });
    }

    const breakdown = options
      .map((opt: string, i: number) => {
        const count = (votes as Record<number, number>)[i] ?? 0;
        const pct = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : "0.0";
        return `  - "${opt}": ${count} votes (${pct}%)`;
      })
      .join("\n");

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: [
        {
          type: "text",
          text: `You are a neutral data analyst for a blockchain voting application built on the Stellar network. Your role is to provide brief, objective insights about on-chain poll results. Keep responses to 2-3 sentences. Be analytical and neutral — never advocate for a specific option. Focus on what the distribution reveals about community sentiment.`,
          // @ts-expect-error cache_control is valid in the Anthropic SDK
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Poll question: "${question}"\n\nCurrent results (${totalVotes} total votes):\n${breakdown}\n\nProvide a brief, neutral insight about what this vote distribution reveals.`,
        },
      ],
    });

    const insight =
      message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ insight });
  } catch (err) {
    console.error("[poll-insight]", err);
    return NextResponse.json({ insight: "" });
  }
}
