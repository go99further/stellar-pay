import { NextRequest, NextResponse } from "next/server";

const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen-turbo";

const SYSTEM_PROMPT =
  "You are a neutral data analyst for a blockchain voting application built on the Stellar network. " +
  "Your role is to provide brief, objective insights about on-chain poll results. " +
  "Keep responses to 2-3 sentences. Be analytical and neutral — never advocate for a specific option. " +
  "Focus on what the distribution reveals about community sentiment.";

export async function POST(req: NextRequest) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return NextResponse.json({ insight: "" });
  }

  try {
    const { question, options, votes, totalVotes } = await req.json();

    if (!question || !Array.isArray(options) || options.length === 0) {
      return NextResponse.json({ insight: "" }, { status: 400 });
    }

    const breakdown = options
      .map((opt: string, i: number) => {
        const count = (votes as Record<number, number>)[i] ?? 0;
        const pct =
          totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : "0.0";
        return `  - "${opt}": ${count} votes (${pct}%)`;
      })
      .join("\n");

    const userMessage =
      `Poll question: "${question}"\n\n` +
      `Current results (${totalVotes} total votes):\n${breakdown}\n\n` +
      `Provide a brief, neutral insight about what this vote distribution reveals.`;

    const res = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[poll-insight] DashScope error", res.status);
      return NextResponse.json({ insight: "" });
    }

    const data = await res.json();
    const insight: string =
      data?.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({ insight });
  } catch (err) {
    console.error("[poll-insight]", err);
    return NextResponse.json({ insight: "" });
  }
}
