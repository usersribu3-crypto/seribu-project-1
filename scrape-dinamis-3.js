import puppeteer from "puppeteer-core";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import fs from "fs";

async function scrapeAndSave(page, allResults) {
  const html = await page.content();
  const $ = cheerio.load(html);

    // fs.writeFileSync("fullpage.html", html, "utf-8");
    // console.log("✅ HTML tersimpan di fullpage.html");


  const newResults = [];
  $(".Nv2PK").each((_, el) => {
    const name = $(el).find(".qBF1Pd").text().trim();
    const rating = $(el).find(".MW4etd").text().trim();
    const reviews = $(el).find(".UY7F9").text().trim();
    const category = $(el).find(".W4Efsd span:first-child span").text().trim();
    const address = $(el).find(".W4Efsd span:nth-child(3)").text().trim();
    const link = $(el).find("a.hfpxzc").attr("href");
    newResults.push({ name, rating, reviews, category, address, link });
  });

  // merge hasil baru (hindari duplikat berdasarkan nama)
  const merged = [
    ...allResults,
    ...newResults.filter((n) => !allResults.find((a) => a.name === n.name)),
  ];

  fs.writeFileSync("./detail/lists-cafes-bandung-utara-19.json", JSON.stringify(merged, null, 2));
  console.log(`💾 Disimpan sementara (${merged.length} data)`);

  return merged;
}

async function autoScrollInfinite(page) {
  console.log("♾️ Infinite scroll mode aktif (Ctrl + C untuk stop)...");
  const allResults = [];
  let lastCount = 0;
  let idleCount = 0;

  while (true) {
    await page.evaluate(() => {
      const container = document.querySelector('[aria-label^="Hasil untuk"]');
      if (container) container.scrollBy(0, 1500);
    });

    await new Promise((r) => setTimeout(r, 1500));

    const count = await page.$$eval(".Nv2PK", (els) => els.length);
    if (count !== lastCount) {
      idleCount = 0;
      lastCount = count;

      const merged = await scrapeAndSave(page, allResults);
      allResults.length = 0;
      allResults.push(...merged);
    } else {
      idleCount++;
      if (idleCount > 10) {
        console.log("⏸️ Pause 5 detik (nggak ada data baru)...");
        await new Promise((r) => setTimeout(r, 5000));
        idleCount = 0;
      }
    }
  }
}

(async () => {
  const debugUrl = "http://127.0.0.1:9222/json/version";
  const res = await fetch(debugUrl);
  const data = await res.json();
  const wsUrl = data.webSocketDebuggerUrl;

  console.log("✅ Terhubung ke Chrome:", wsUrl);
  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  const page = await browser.newPage();

  const query = "cafe di dekat Cibiru, Kota Bandung, Jawa Barat";
  console.log(`🔍 Membuka Google Maps untuk "${query}"...`);

  await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}/`, {
    waitUntil: "domcontentloaded",
    timeout: 0,
  });

  await page.waitForSelector('[aria-label^="Hasil untuk"]', { timeout: 40000 });

  await autoScrollInfinite(page);
})();
