// exchanges/Hyperliquid.js
import fetch from "node-fetch";

const BASE_URL = "https://api.hyperliquid.xyz/info";

async function safeFetch(body) {
  const resp = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Error fetch ${BASE_URL}: ${resp.status}`);
  return resp.json();
}

export default class Hyperliquid {
  constructor() {
    this.name = "Hyperliquid";
    this.baseUrl = BASE_URL;
  }

  // -------------------------------------------------------
  // 🔹 Tokens disponibles
  // -------------------------------------------------------
  async getAvailableTokens() {
    try {
      const res = await safeFetch({ type: "metaAndAssetCtxs" });
      const universe = res?.[0]?.universe ?? [];
      return universe.map((a) => a.name);
    } catch (err) {
      console.error("❌ Error getAvailableTokens:", err.message);
      return [];
    }
  }

  // -------------------------------------------------------
  // 🔹 Datos de mercado (precio, OI, volumen, funding actual)
  // -------------------------------------------------------
  async getTokenData(token) {
    try {
      const metaRes = await safeFetch({ type: "metaAndAssetCtxs" });
      const universe = metaRes?.[0]?.universe ?? [];
      const marketData = metaRes?.[1] ?? [];

      const idx = universe.findIndex((a) => a.name === token);
      if (idx === -1) throw new Error(`Token ${token} no encontrado`);

      const info = universe[idx];
      const market = marketData[idx];

      let bid = parseFloat(market?.impactPxs?.[0] ?? 0);
      let ask = parseFloat(market?.impactPxs?.[1] ?? 0);
      const fundingRate = parseFloat(market?.funding ?? 0);
      const oraclePx = parseFloat(market?.oraclePx ?? 0);

      if (!bid && oraclePx) bid = oraclePx;
      if (!ask && oraclePx) ask = oraclePx;
      const midPrice = bid && ask ? (bid + ask) / 2 : oraclePx;

      const openInterestToken = parseFloat(market?.openInterest ?? 0);
      const openInterestUSD = openInterestToken * midPrice;
      const volumeUSD = parseFloat(market?.dayNtlVlm ?? 0);

      return {
        exchange: this.name,
        token: info.name,
        fundingRate,
        openInterest: openInterestUSD,
        volume: volumeUSD,
        bid,
        ask,
        midPrice,
      };
    } catch (err) {
      console.error("❌ Error getTokenData:", err.message);
      return null;
    }
  }

  // -------------------------------------------------------
  // 🔹 Funding histórico (live, 8h, 1d, 7d, 14d, 31d)
  // -------------------------------------------------------
  async getFundingHistory(coin, timeframe = 24) {
    try {
      const nowMs = Date.now();
      let startTimeMs;

      switch(timeframe) {
        case "live": startTimeMs = nowMs - 1 * 3600 * 1000; break; // 1h en ms
        case 8: startTimeMs = nowMs - 8 * 3600 * 1000; break;
        case 24: startTimeMs = nowMs - 24 * 3600 * 1000; break;
        case 24*7: startTimeMs = nowMs - 24*7*3600*1000; break;
        case 24*14: startTimeMs = nowMs - 24*14*3600*1000; break;
        case 24*31: startTimeMs = nowMs - 24*31*3600*1000; break;
        default: startTimeMs = nowMs - Number(timeframe) * 3600 * 1000;
      }
      
      const body = { type: "fundingHistory", coin, startTime: startTimeMs };
      console.log(body);
      const res = await safeFetch(body);

      if (!Array.isArray(res) || !res.length) {
        console.warn(`⚠️ No hay funding history para ${coin} timeframe ${timeframe}`);
        return null;
      }

      const rates = res
        .map(f => parseFloat(f.fundingRate))
        .filter(r => !isNaN(r));

      if (!rates.length) return { avgFundingRate: 0, apr: 0, data: [] };

      const avgFundingRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;

      // Intervalo promedio real entre registros en horas
      let intervalHours = 0;
      if (res.length > 1) {
        const diffs = [];
        for (let i = 1; i < res.length; i++) {
          diffs.push((res[i].time - res[i-1].time) / 1000 / 3600);
        }
        intervalHours = diffs.reduce((s, d) => s + d, 0) / diffs.length;
      } else {
        intervalHours = 1;
      }

      const apr = avgFundingRate * (8760 / intervalHours);

      return { avgFundingRate, apr, data: res };

    } catch (err) {
      console.error(`❌ Error getFundingHistory ${coin}:`, err.message);
      return null;
    }
  }
}
