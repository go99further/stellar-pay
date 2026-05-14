import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "price-dataset.json");

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Dataset not found. Run: npx tsx scripts/fetch-price-data.ts" },
      { status: 404 }
    );
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const dataset = JSON.parse(raw);

  return NextResponse.json(dataset, {
    headers: {
      // Cache for 1 hour — dataset is regenerated manually
      "Cache-Control": "public, max-age=3600",
    },
  });
}
