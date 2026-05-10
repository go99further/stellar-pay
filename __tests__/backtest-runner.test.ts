import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAllAndReport } from "../scripts/backtest/run";

describe("Security Agent backtest", () => {
  it("runs all scenarios and writes BACKTEST_REPORT.md", () => {
    const { markdown, passed, total } = runAllAndReport();
    const outPath = join(process.cwd(), "BACKTEST_REPORT.md");
    writeFileSync(outPath, markdown);

    // eslint-disable-next-line no-console
    console.log(`\n[backtest] ${passed}/${total} passed → ${outPath}`);

    // We *don't* require 100% pass on the gate — this test records current
    // accuracy. Tighten later once detectors improve.
    expect(total).toBeGreaterThan(0);
  });
});
