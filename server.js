const express = require("express");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/rss-proxy", async (req, res) => {
  const { url, mode } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url parameter is required" });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: "Only http and https URLs are allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (mode === "ogp") {
    try {
      const html = await fetchHtmlHead(url);
      const match =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      const ogImage = match ? match[1] : null;
      return res.json({ ogImage });
    } catch (err) {
      return res.status(502).json({ error: "Failed to fetch OGP", detail: err.message });
    }
  }

  try {
    const content = await fetchUrl(url);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.send(content);
  } catch (err) {
    return res.status(502).json({ error: "Failed to fetch RSS feed", detail: err.message });
  }
});

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; rss-proxy/1.0)" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function fetchHtmlHead(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const MAX_BYTES = 65536;
    client
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ogp-proxy/1.0)" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchHtmlHead(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = "";
        let size = 0;
        res.on("data", (chunk) => {
          data += chunk.toString("utf-8");
          size += chunk.length;
          if (size >= MAX_BYTES) res.destroy();
        });
        res.on("close", () => resolve(data));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

app.listen(PORT, () => {
  console.log(`RSS proxy server running on port ${PORT}`);
});
