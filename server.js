// server.js
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import Aster from "./exchanges/Aster.js";
import Lighter from "./exchanges/Lighter.js";
import Hyperliquid from "./exchanges/Hyperliquid.js";
import Pacifica from "./exchanges/Pacifica.js";

// Cargar variables de entorno (.env local o Railway env vars)
dotenv.config();

const app = express();
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;

// --- 🔐 Middleware de autenticación solo para endpoints /api ---
app.use("/api", (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

// --- 🔹 Endpoint para enviar token al frontend (NO protegido) ---
app.get("/config.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`window.API_TOKEN = "${process.env.API_TOKEN || ""}";`);
});

const aster = new Aster();
const lighter = new Lighter();
const hyperliquid = new Hyperliquid();
const pacifica = new Pacifica();

const tokensAster = await aster.getAvailableTokens("USDT");
const tokensHyper = await hyperliquid.getAvailableTokens();

const allTokens = [...new Set([...tokensAster, ...tokensHyper])];
// const allTokens = ['YZY'];

// Mapeo exchanges a IDs
const exchangeMap = { Aster: 4, Lighter: 6, Hyperliquid: 1, Pacifica: 7 };

// Cache
let cachedOpportunities = [];
let lastUpdate = null;

const SNAPSHOT_FILE = path.join(__dirname, "data", "opportunities.json");

// Cargar cache desde opportunities.json
if (fs.existsSync(SNAPSHOT_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8"));
    cachedOpportunities = saved.opportunities || [];
    lastUpdate = saved.lastUpdate || null;
    console.log(`📂 Cache cargada con ${cachedOpportunities.length} oportunidades`);
  } catch (err) {
    console.error("⚠️ Error leyendo cache:", err.message);
  }
}

// ------------------ 🔧 Construcción de oportunidades ------------------
function buildOpportunities(token, ex1, ex2) {
  const opportunities = [];

  function calcApr(longEx, shortEx) {
    let gain = 0;
    if (longEx.fundingRate < 0) {
      gain += Math.abs(longEx.fundingRate);
    } else {
      gain -= longEx.fundingRate;
    }
    if (shortEx.fundingRate > 0) {
      gain += shortEx.fundingRate;
    } else {
      gain -= Math.abs(shortEx.fundingRate);
    }
    return gain * 8760;
  }

  // Estrategia 1: long ex1, short ex2
  const apr1 = calcApr(ex1, ex2);
  const spread1 = ex1.ask && ex2.bid ? (ex2.bid - ex1.ask) / ex1.ask : null;

  if (apr1 > 1 || (spread1 !== null && spread1 > 0)) {
    opportunities.push({
      token,
      buyExchange: exchangeMap[ex1.exchange],
      sellExchange: exchangeMap[ex2.exchange],
      avgFundingBuy: ex1.fundingRate,
      avgFundingSell: ex2.fundingRate,
      apr: apr1,
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

  // Estrategia 2: long ex2, short ex1
  const apr2 = calcApr(ex2, ex1);
  const spread2 = ex2.ask && ex1.bid ? (ex1.bid - ex2.ask) / ex2.ask : null;

  if (apr2 > 1 || (spread2 !== null && spread2 > 0)) {
    opportunities.push({
      token,
      buyExchange: exchangeMap[ex2.exchange],
      sellExchange: exchangeMap[ex1.exchange],
      avgFundingBuy: ex2.fundingRate,
      avgFundingSell: ex1.fundingRate,
      apr: apr2,
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

// ------------------ 🔁 Ciclo grande (actualización dinámica) ------------------
async function updateCache() {
  console.log("♻️ Actualizando oportunidades (ciclo grande)...");
  lastUpdate = new Date().toISOString();

  for (const token of allTokens) {
    console.log("🌀 Procesando " + token);

    const results = await Promise.allSettled([
      aster.getTokenData(token, "USDT"),
      lighter.getTokenData(token),
      hyperliquid.getTokenData(token),
      pacifica.getTokenData(token),
    ]);

    const available = results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);

    let newOpps = [];
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        newOpps.push(...buildOpportunities(token, available[i], available[j]));
      }
    }

    cachedOpportunities = cachedOpportunities.filter((opp) => opp.token !== token);
    if (newOpps.length) cachedOpportunities.push(...newOpps);

    fs.writeFileSync(
      SNAPSHOT_FILE,
      JSON.stringify({ lastUpdate, opportunities: cachedOpportunities }, null, 2)
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`🎯 Ciclo grande terminado. Total oportunidades: ${cachedOpportunities.length}`);
  updateCache();
}

updateCache();

// ------------------ 🌐 API protegida ------------------
app.get("/api/opportunity", (req, res) => {
  const { exchanges } = req.query;
  let opportunities = cachedOpportunities;

  if (typeof exchanges !== "undefined") {
    const selected =
      exchanges === ""
        ? []
        : exchanges
            .split(",")
            .map((id) => parseInt(id.trim(), 10))
            .filter((n) => !isNaN(n));

    if (selected.length === 0) {
      return res.json({ lastUpdate, opportunities: [] });
    }

    opportunities = opportunities.filter(
      (opp) => selected.includes(opp.buyExchange) && selected.includes(opp.sellExchange)
    );
  }

  res.json({ lastUpdate, opportunities });
});

// ------------------ 🖥️ Frontend público ------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------ 🚀 Start ------------------
app.listen(PORT, () => {
  console.log(`✅ Proxy corriendo en http://localhost:${PORT}`);
});
