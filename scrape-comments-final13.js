import puppeteer from "puppeteer-core";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import fs from "fs";

// 🧹 Fungsi pembersih karakter aneh
function cleanText(str) {
  return str
    ? str
        .replace(/&nbsp;/g, " ")        // hapus entity HTML
        .replace(/[\uE000-\uF8FF]/g, "") // hapus karakter ikon Google
        .replace(/\u00A0/g, " ")        // hapus non-breaking space
        .replace(/\s+/g, " ")           // normalisasi spasi
        .trim()
    : "";
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 🔹 Auto scroll semua ulasan
async function autoScrollReviews(page, placeName) {
  console.log(`🌀 Scroll ulasan untuk "${placeName}"...`);
  const containerSelector = `div[aria-label="${placeName}"]`;
  await page.waitForSelector(containerSelector, { timeout: 20000 });

  let prevCount = 0;
  let stable = 0;

  while (stable < 6) {
    const count = await page.$$eval(".jftiEf.fontBodyMedium", (els) => els.length);
    if (count === prevCount) {
      stable++;
      console.log(`⏳ Tidak ada review baru (${stable}/6)...`);
    } else {
      prevCount = count;
      stable = 0;
      console.log(`📜 Review termuat: ${count}`);
    }

    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el)
        el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 2000 }));
    }, containerSelector);

    await delay(1500);
  }
  console.log("✅ Semua ulasan termuat!");
}

// 🔹 Ambil semua data penting dari halaman detail
async function extractReviews(page, cafeData) {
  const html = await page.content();
  const $ = cheerio.load(html);

  fs.writeFileSync("./detail/html/detail.html", html, "utf-8");

  // 🏠 Ambil alamat
  const alamat_google = cleanText(
    $('[data-item-id="address"]').text() ||
      $('[itemprop="address"]').text() ||
      $("button[data-item-id='address']").text()
  );

  // 💰 Ambil range harga “Rp 25.000–50.000 per orang” dan “Dilaporkan oleh ...”
  let range_harga = null;
  let dilaporkan_oleh = null;

  // Regex fleksibel: tangkap harga dan laporan pengguna
  const matchHargaBlock = html.match(
    /Rp[\s\S]{0,30}?[\d.,]+[\s\u2013–-]+[\d.,]+\s*(?:<\/?[^>]+>)*per\s*orang(?:.*?<div[^>]*class="BfVpR"[^>]*>([^<]+)<\/div>)?/i
  );

  if (matchHargaBlock) {
    // Ambil teks “Rp 25.000–50.000 per orang”
    const hargaMatch = matchHargaBlock[0].match(
      /Rp[\s\S]{0,30}?[\d.,]+[\s\u2013–-]+[\d.,]+\s*(?:<\/?[^>]+>)*per\s*orang/i
    );
    if (hargaMatch) range_harga = cleanText(hargaMatch[0]);

    // Ambil teks “Dilaporkan oleh ...”
    if (matchHargaBlock[1]) {
      dilaporkan_oleh = cleanText(matchHargaBlock[1]);
    }
  } else {
    console.log("⚠️ Range harga 'per orang' tidak ditemukan di HTML");
  }

  // ☎️ Nomor telepon
  let phone_number = cleanText(
    $('[data-item-id^="phone"]').text() ||
      $('[aria-label^="Telepon"]').text() ||
      $('[href^="tel:"]').attr("href")?.replace("tel:", "")
  );
  if (!phone_number) {
    const matchPhone = html.match(/(\+62|0)[0-9\-\s]{7,15}/);
    if (matchPhone) phone_number = cleanText(matchPhone[0]);
  }

  // 📍 Koordinat dari URL
  let lat = null,
    lon = null;
  if (cafeData.link) {
    let match = cafeData.link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (match) {
      lat = parseFloat(match[1]);
      lon = parseFloat(match[2]);
    } else {
      match = cafeData.link.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (match) {
        lat = parseFloat(match[1]);
        lon = parseFloat(match[2]);
      }
    }
  }

  // ⭐ Review
  const reviews_detail = [];
  $(".jftiEf.fontBodyMedium").each((_, el) => {
    const nama = cleanText($(el).find(".d4r55").text());
    const rating = cleanText($(el).find(".kvMYJc").attr("aria-label"));
    const tanggal = cleanText($(el).find(".rsqaWe").text());
    const isi = cleanText($(el).find(".wiI7pd").text());
    if (nama) reviews_detail.push({ nama, rating, tanggal, isi });
  });

  return {
    ...cafeData,
    lat,
    lon,
    alamat_google,
    range_harga,
    dilaporkan_oleh,
    phone_number,
    reviews_detail,
  };
}

// 🔧 Main Process
(async () => {
  const cafes = JSON.parse(fs.readFileSync("./detail/lists-cafes-bandung-utara.json", "utf8"));
  const outputFile = "./detail/data.json";

  let hasilFinal = [];
  if (fs.existsSync(outputFile)) {
    hasilFinal = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    console.log(`📂 File lama ditemukan (${hasilFinal.length} kafe sudah disimpan)`);
  }

  const processedNames = new Set(hasilFinal.map((x) => x.name));

  const debugUrl = "http://127.0.0.1:9222/json/version";
  const res = await fetch(debugUrl);
  const data = await res.json();
  const wsUrl = data.webSocketDebuggerUrl;
  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });

  for (const cafe of cafes) {
    if (processedNames.has(cafe.name)) {
      console.log(`⚠️ Skip: ${cafe.name} sudah ada di file hasil`);
      continue;
    }

    console.log(`\n===============================`);
    console.log(`☕ Scraping: ${cafe.name}`);

    try {
      const page = await browser.newPage();
      console.log(`🌐 Membuka: ${cafe.link}`);
      await page.goto(cafe.link, { waitUntil: "domcontentloaded", timeout: 0 });

      await page.waitForSelector(`div[aria-label="${cafe.name}"]`, { timeout: 40000 });

      await autoScrollReviews(page, cafe.name);
      const result = await extractReviews(page, cafe);
      hasilFinal.push(result);

      fs.writeFileSync(outputFile, JSON.stringify(hasilFinal, null, 2));
      console.log(
        `✅ Disimpan: ${cafe.name} (${result.range_harga || "tanpa harga"}, ${
          result.phone_number || "tanpa telepon"
        })`
      );

      await page.close();
    } catch (err) {
      console.error(`❌ Gagal scrape ${cafe.name}:`, err.message);
    }

    console.log("⏳ Tunggu 10 detik sebelum lanjut...");
    await delay(10000);
  }

  await browser.disconnect();
  console.log("\n🎉 Semua kafe selesai di-scrape!");
  console.log(`📁 File hasil akhir: ${outputFile}`);
})();
