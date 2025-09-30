// server.js
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import Aster from "./exchanges/Aster.js";
import Lighter from "./exchanges/Lighter.js";
import Hyperliquid from "./exchanges/Hyperliquid.js";

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const aster = new Aster();
const lighter = new Lighter();
const hyperliquid = new Hyperliquid();

const tokensAster = await aster.getAvailableTokens("USDT");
//const tokensLighter = await lighter.getAvailableTokens();
const tokensHyper = await hyperliquid.getAvailableTokens();


const allTokens = [...new Set([...tokensAster, /*...tokensLighter, */...tokensHyper])];
//const allTokens = ["ETH", "BTC", "SOL", "BNB", "PUMP", "ASTER", "HYPE", "YZY"]

// Mapeo exchanges a IDs (los mismos que el frontend usa)
const exchangeMap = { Aster: 4, Lighter: 6, Hyperliquid: 1 };

// Cache
let cachedOpportunities = [];
let lastUpdate = null;
const SNAPSHOT_FILE = path.join(__dirname, "data", "opportunities.json");

if (fs.existsSync(SNAPSHOT_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8"));
    cachedOpportunities = saved.opportunities || [];
    lastUpdate = saved.lastUpdate || null;
    console.log(`📂 Snapshot cargado con ${cachedOpportunities.length} oportunidades`);
  } catch (err) {
    console.error("⚠️ Error leyendo snapshot:", err.message);
  }
}

// Construcción de oportunidades
function buildOpportunities(token, ex1, ex2) {
  const opportunities = [];

    const spread1 = ex1.ask && ex2.bid
    ? ((ex2.bid - ex1.ask) / ex1.ask)
    : null;

  if ((spread1 > 0 || ex2.fundingRate > ex1.fundingRate)) {
    opportunities.push({
      token,
      buyExchange: exchangeMap[ex1.exchange],
      sellExchange: exchangeMap[ex2.exchange],
      avgFundingBuy: ex1.fundingRate,
      avgFundingSell: ex2.fundingRate,
      apr: ((ex2.fundingRate - ex1.fundingRate) * 8760),
      buyOI: ex1.openInterest,
      sellOI: ex2.openInterest,
      buyVolume: ex1.volume,
      sellVolume: ex2.volume,
      buyBid: ex1.bid,
      buyAsk: ex1.ask,
      buyMidPrice: ex1.midPrice,
      sellBid: ex2.bid,
      sellAsk: ex2.ask,
      sellMidPrice: ex2.midPrice,
      spread: spread1,
    });
  }

    const spread2 = ex2.ask && ex1.bid
    ? ((ex1.bid - ex2.ask) / ex2.ask)
    : null;

  if ((spread2 > 0 || ex1.fundingRate > ex2.fundingRate)) {
    opportunities.push({
      token,
      buyExchange: exchangeMap[ex2.exchange],
      sellExchange: exchangeMap[ex1.exchange],
      avgFundingBuy: ex2.fundingRate,
      avgFundingSell: ex1.fundingRate,
      apr: ((ex1.fundingRate - ex2.fundingRate) * 8760),
      buyOI: ex2.openInterest,
      sellOI: ex1.openInterest,
      buyVolume: ex2.volume,
      sellVolume: ex1.volume,
      buyBid: ex2.bid,
      buyAsk: ex2.ask,
      buyMidPrice: ex2.midPrice,
      sellBid: ex1.bid,
      sellAsk: ex1.ask,
      sellMidPrice: ex1.midPrice,
      spread: spread2,
    });
  }

  return opportunities;
}

// Actualizador
async function updateCache() {
  try {
    console.log("♻️ Actualizando oportunidades...");
    let opportunities = [];

    for (const token of allTokens) {
      const results = await Promise.allSettled([
        aster.getTokenData(token, "USDT"),
        lighter.getTokenData(token),
        hyperliquid.getTokenData(token),
      ]);

      const available = results.filter(r => r.status === "fulfilled").map(r => r.value);

      for (let i = 0; i < available.length; i++) {
        for (let j = i + 1; j < available.length; j++) {
          opportunities.push(...buildOpportunities(token, available[i], available[j]));
        }
      }
    }

    const seen = new Set();
    opportunities = opportunities.filter(opp => {
      const key = `${opp.token}-${opp.buyExchange}-${opp.sellExchange}`;
      const inverseKey = `${opp.token}-${opp.sellExchange}-${opp.buyExchange}`;
      if (opp.apr <= 0 && opp.spread <= 0) return false;
      if (seen.has(inverseKey)) return false;
      seen.add(key);
      return true;
    });

    cachedOpportunities = opportunities;
    lastUpdate = new Date().toISOString();

    const dir = path.dirname(SNAPSHOT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      SNAPSHOT_FILE,
      JSON.stringify({ lastUpdate, opportunities: cachedOpportunities }, null, 2)
    );

    console.log(`✅ Cache actualizada con ${cachedOpportunities.length} oportunidades`);
    updateCache()
  } catch (err) {
    console.error("❌ Error actualizando cache:", err);
  }
}

updateCache();

// Endpoint: filtra desde la cache según exchanges seleccionados
app.get("/api/opportunity", (req, res) => {
  const { exchanges } = req.query;
  let opportunities = cachedOpportunities;

  if (typeof exchanges !== "undefined") {
    // si viene '?exchanges=' vacío queremos interpretar como "ninguno seleccionado"
    const selected = exchanges === "" 
      ? [] 
      : exchanges.split(",").map(id => parseInt(id.trim(), 10)).filter(n => !isNaN(n));

    // si no hay ninguno seleccionado devolvemos lista vacía (comportamiento esperado)
    if (selected.length === 0) {
      return res.json({ lastUpdate, opportunities: [] });
    }

    // REQUERIMOS que BOTH exchanges (buy y sell) estén dentro de 'selected'
    opportunities = opportunities.filter(
      opp => selected.includes(opp.buyExchange) && selected.includes(opp.sellExchange)
    );
  }

  res.json({ lastUpdate, opportunities });
});

// Frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Proxy corriendo en http://localhost:${PORT}`);
});