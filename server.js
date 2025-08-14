import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("/**
 * Car Matchmaker — single-file Node/Express app
 *
 * Features
 * - Enter desired seats, max price (budget), and type (luxury, sport, comfort, suv, electric, minivan, etc.)
 * - Returns matching year+model suggestions with links to search listings
 * - (Optional) Generates a photorealistic car image via OpenAI Images API (gpt-image-1)
 *
 * Quick start
 * 1) Save as server.js
 * 2) npm init -y && npm install express openai cors
 * 3) Set your API key:  mac/linux:  export OPENAI_API_KEY=sk-...   windows (powershell):  $env:OPENAI_API_KEY="sk-..."
 * 4) node server.js
 * 5) Open http://localhost:3000
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

// ---- OpenAI (optional image generation) ----
// Uses official SDK: npm i openai
// Docs: https://platform.openai.com/docs/libraries  |  https://platform.openai.com/docs/guides/image-generation
let openaiClient = null;
try {
  const OpenAI = require("openai");
  if (process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (e) {
  // SDK not installed, image endpoint will be disabled gracefully
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---- Minimal knowledge base (editable) ----
// Each entry: model, minSeats, types, priceBands (EUR), yearsByBand (suggested year for that price)
// These are heuristic ranges; update with your own data if you like.
const CARS = [
  { model: "Toyota Camry", minSeats: 5, types: ["comfort", "sedan", "economy"], priceBands: [12000, 18000, 25000, 35000], yearsByBand: [2015, 2018, 2021, 2024] },
  { model: "Honda Accord", minSeats: 5, types: ["comfort", "sedan", "economy"], priceBands: [12000, 18000, 26000, 36000], yearsByBand: [2015, 2018, 2021, 2024] },
  { model: "Kia Telluride", minSeats: 7, types: ["comfort", "suv", "family"], priceBands: [26000, 33000, 42000, 55000], yearsByBand: [2020, 2021, 2022, 2024] },
  { model: "Honda Odyssey", minSeats: 7, types: ["minivan", "family", "comfort"], priceBands: [16000, 23000, 32000, 45000], yearsByBand: [2016, 2018, 2021, 2024] },
  { model: "Mercedes-Benz S-Class", minSeats: 5, types: ["luxury", "sedan"], priceBands: [28000, 40000, 65000, 110000], yearsByBand: [2014, 2017, 2020, 2023] },
  { model: "BMW 7 Series", minSeats: 5, types: ["luxury", "sedan"], priceBands: [22000, 35000, 55000, 100000], yearsByBand: [2014, 2017, 2020, 2023] },
  { model: "Lexus LS", minSeats: 5, types: ["luxury", "sedan", "comfort"], priceBands: [20000, 30000, 45000, 80000], yearsByBand: [2013, 2016, 2019, 2023] },
  { model: "Cadillac Escalade", minSeats: 7, types: ["luxury", "suv"], priceBands: [30000, 45000, 70000, 110000], yearsByBand: [2015, 2018, 2021, 2024] },
  { model: "Tesla Model S", minSeats: 5, types: ["luxury", "electric", "sedan"], priceBands: [26000, 38000, 55000, 90000], yearsByBand: [2014, 2017, 2020, 2023] },
  { model: "Tesla Model 3", minSeats: 5, types: ["electric", "comfort", "sedan"], priceBands: [18000, 26000, 35000, 55000], yearsByBand: [2019, 2020, 2021, 2024] },
  { model: "Toyota RAV4", minSeats: 5, types: ["suv", "comfort", "economy"], priceBands: [12000, 17000, 26000, 38000], yearsByBand: [2015, 2017, 2020, 2023] },
  { model: "Mazda MX-5 Miata", minSeats: 2, types: ["sport", "roadster"], priceBands: [12000, 18000, 26000, 36000], yearsByBand: [2014, 2016, 2019, 2023] },
  { model: "Porsche 911", minSeats: 4, types: ["sport", "luxury"], priceBands: [45000, 70000, 110000, 180000], yearsByBand: [2009, 2014, 2017, 2022] },
  { model: "Chevrolet Corvette", minSeats: 2, types: ["sport"], priceBands: [35000, 50000, 70000, 120000], yearsByBand: [2014, 2017, 2020, 2023] },
  { model: "BMW M3", minSeats: 5, types: ["sport", "sedan"], priceBands: [30000, 45000, 65000, 90000], yearsByBand: [2015, 2018, 2021, 2023] },
  { model: "Ford Mustang", minSeats: 4, types: ["sport", "coupe"], priceBands: [15000, 22000, 32000, 50000], yearsByBand: [2015, 2017, 2020, 2023] },
];

function pickYearForBudget(priceBands, yearsByBand, budget) {
  // priceBands sorted ascending; choose the highest band <= budget, else the closest above
  for (let i = priceBands.length - 1; i >= 0; i--) {
    if (budget >= priceBands[i]) return yearsByBand[i];
  }
  return yearsByBand[0];
}

function affordabilityScore(priceBands, budget) {
  // lower is better; 0 if budget within top band range, else distance to nearest band
  const minBand = priceBands[0];
  const maxBand = priceBands[priceBands.length - 1];
  if (budget >= minBand && budget <= maxBand) return 0;
  if (budget < minBand) return minBand - budget;
  return budget - maxBand;
}

function buildSearchLinks(year, model) {
  const q = encodeURIComponent(`${year} ${model}`);
  return {
    google: `https://www.google.com/search?q=${q}+for+sale`,
    autoscout: `https://www.autoscout24.com/lst?sort=standard&desc=0&ustate=N%2CU&atype=C&powertype=kw&fregto=${year}&fregfrom=${year}&q=${encodeURIComponent(model)}`,
    cars: `https://www.cars.com/shopping/results/?q=${q}`,
  };
}

app.post("/search", (req, res) => {
  const { seats, budget, type } = req.body || {};
  const wantSeats = Number(seats) || 4;
  const wantBudget = Number(budget) || 20000;
  const wantType = String(type || "").toLowerCase();

  const matches = CARS
    .filter(c => c.minSeats >= wantSeats || c.minSeats === wantSeats || c.minSeats > wantSeats - 1)
    .filter(c => !wantType || c.types.includes(wantType))
    .map(c => {
      const year = pickYearForBudget(c.priceBands, c.yearsByBand, wantBudget);
      const score = affordabilityScore(c.priceBands, wantBudget) + Math.max(0, wantSeats - c.minSeats) * 5000;
      const links = buildSearchLinks(year, c.model);
      return {
        model: c.model,
        year,
        seats: c.minSeats,
        typeMatches: c.types,
        links,
        score,
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  // If no matches due to strict type, relax type filter
  if (matches.length === 0) {
    const relaxed = CARS
      .filter(c => c.minSeats >= wantSeats)
      .map(c => {
        const year = pickYearForBudget(c.priceBands, c.yearsByBand, wantBudget);
        const score = affordabilityScore(c.priceBands, wantBudget) + Math.max(0, wantSeats - c.minSeats) * 5000 + 10000; // small penalty for relaxed
        const links = buildSearchLinks(year, c.model);
        return { model: c.model, year, seats: c.minSeats, typeMatches: c.types, links, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    return res.json({ results: relaxed, relaxed: true });
  }

  res.json({ results: matches, relaxed: false });
});

app.post("/image", async (req, res) => {
  if (!openaiClient) {
    return res.status(501).json({ error: "Image generation unavailable (missing OPENAI_API_KEY or SDK)." });
  }
  const { year, model } = req.body || {};
  const prompt = `Photorealistic dealership-style exterior photo of a ${year} ${model}, parked, clean background, natural lighting.`;
  try {
    const img = await openaiClient.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });
    const b64 = img.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned");
    res.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- Simple UI ----
app.get("/", (req, res) => {
  res.type("html").send(`
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Car Matchmaker</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Inter, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #0b0c10; color: #e6e6e6; }
      .card { background: #111217; border: 1px solid #20222b; border-radius: 16px; padding: 20px; max-width: 900px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
      h1 { margin-top: 0; font-size: 28px; }
      label { display:block; margin: 10px 0 6px; font-weight: 600; }
      input, select, button { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid #2b2e39; background: #0f1117; color: #e6e6e6; }
      button { background: #4f46e5; border: none; font-weight: 700; cursor: pointer; }
      button:hover { filter: brightness(1.1); }
      .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
      .result { border: 1px solid #252838; border-radius: 16px; padding: 16px; background: #0d0f16; }
      .links a { color: #9bb2ff; text-decoration: none; margin-right: 12px; }
      .badge { display:inline-block; padding: 4px 10px; border-radius: 999px; background: #1b1e2b; border: 1px solid #2a2e44; font-size: 12px; margin-right: 6px; }
      .imgwrap { margin-top: 10px; }
      .imgwrap img { max-width: 100%; border-radius: 12px; border: 1px solid #2a2e44; }
      .footer { opacity: 0.7; font-size: 12px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Car Matchmaker</h1>
      <p>Tell me how many people you need to fit, your max budget, and the vibe (luxury, sport, comfort, suv, electric, minivan, etc.). I'll suggest models, estimate a year, and give you listing links. If you set an OpenAI API key on the server, I can also generate an image of the top pick.</p>
      <div class="grid">
        <div>
          <label>Seats needed</label>
          <input id="seats" type="number" min="1" placeholder="e.g., 5" />
        </div>
        <div>
          <label>Max price (EUR)</label>
          <input id="budget" type="number" min="1000" step="500" placeholder="e.g., 30000" />
        </div>
        <div>
          <label>Type</label>
          <input id="type" placeholder="e.g., luxury / sport / comfort / suv / electric / minivan" />
        </div>
      </div>
      <div style="margin-top:16px; display:flex; gap:12px;">
        <button id="go">Find cars</button>
        <button id="img" title="Generates image for the first result using OpenAI Images" disabled>Generate image of top pick</button>
      </div>

      <div id="out" style="margin-top: 22px;"></div>

      <div class="footer">Tip: Edit server.js to add more cars or tune price bands and types for your market.</div>
    </div>

    <script>
      const out = document.getElementById('out');
      const btn = document.getElementById('go');
      const imgBtn = document.getElementById('img');
      let lastResults = [];

      function tag(t) { return `<span class="badge">${t}</span>` }

      btn.onclick = async () => {
        out.innerHTML = 'Searching…';
        const seats = Number(document.getElementById('seats').value || 5);
        const budget = Number(document.getElementById('budget').value || 25000);
        const type = (document.getElementById('type').value || '').trim();

        const res = await fetch('/search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seats, budget, type }) });
        const data = await res.json();

        lastResults = data.results || [];
        imgBtn.disabled = lastResults.length === 0;

        if (!lastResults.length) {
          out.innerHTML = '<p>No exact matches. Try lowering seats or changing type.</p>';
          return;
        }

        out.innerHTML = `<div class="grid">${lastResults.map(r => `
          <div class="result">
            <div style="font-size:18px; font-weight:700;">${r.year} ${r.model}</div>
            <div style="margin:6px 0 8px;">Seats: ${r.seats}</div>
            <div>${r.typeMatches.map(tag).join(' ')}</div>
            <div class="links" style="margin-top:10px;">
              <a href="${r.links.google}" target="_blank">Google</a>
              <a href="${r.links.autoscout}" target="_blank">AutoScout24</a>
              <a href="${r.links.cars}" target="_blank">Cars.com</a>
            </div>
            <div class="imgwrap" id="img-${r.year}-${r.model.replace(/[^a-z0-9]/ig,'')}"></div>
          </div>`).join('')}</div>`;
      };

      imgBtn.onclick = async () => {
        if (!lastResults.length) return;
        const top = lastResults[0];
        const mountId = `img-${top.year}-${top.model.replace(/[^a-z0-9]/ig,'')}`;
        const mount = document.getElementById(mountId);
        mount.innerHTML = 'Generating image…';
        try {
          const r = await fetch('/image', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ year: top.year, model: top.model }) });
          const j = await r.json();
          if (j.dataUrl) {
            mount.innerHTML = `<img alt="${top.year} ${top.model}" src="${j.dataUrl}" />`;
          } else {
            mount.innerHTML = '<em>Image unavailable.</em>';
          }
        } catch (e) {
          mount.innerHTML = '<em>Image failed.</em>';
        }
      };
    </script>
  </body>
  </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nCar Matchmaker running: http://localhost:${PORT}\n`);
  if (!openaiClient) {
    console.log("(Optional) Set OPENAI_API_KEY and `npm i openai` to enable image generation.");
  }
});
");
});

// Listen on Render’s port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
