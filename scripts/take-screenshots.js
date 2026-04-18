const puppeteer = require("puppeteer");
const path = require("path");

const MOCK_PAGE = "file:///" + path.resolve(__dirname, "mock-ui.html").replace(/\\/g, "/");
const OUT_DIR = path.resolve(__dirname, "..", "screenshots");

const SCENES = [
  {
    name: "wallet-options",
    hash: "wallets",
    height: 620,
    description: "Multi-wallet selection modal",
  },
  {
    name: "wallet-connected",
    hash: "balance",
    height: 560,
    description: "Wallet connected with balance",
  },
  {
    name: "onchain-vote",
    hash: "vote",
    height: 780,
    description: "On-chain poll with live results",
  },
  {
    name: "transaction-result",
    hash: "result",
    height: 780,
    description: "Transaction result with hash",
  },
];

(async () => {
  const browser = await puppeteer.launch({ headless: true });

  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.setViewport({
      width: 800,
      height: scene.height,
      deviceScaleFactor: 2,
    });

    const url = `${MOCK_PAGE}#${scene.hash}`;
    await page.goto(url, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));

    const outPath = path.join(OUT_DIR, `${scene.name}.png`);
    await page.screenshot({ path: outPath, type: "png" });

    console.log(`  ✓ ${scene.name}.png  —  ${scene.description}`);
    await page.close();
  }

  await browser.close();
  console.log(`\n  All ${SCENES.length} screenshots saved to: ${OUT_DIR}`);
})();
