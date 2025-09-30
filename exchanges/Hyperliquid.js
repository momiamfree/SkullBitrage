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

  async getAvailableTokens() {
    try {
      const res = await safeFetch({ type: "metaAndAssetCtxs" });
      const universe = res?.[0]?.universe ?? [];
      return universe.map(a => a.name); // ej: ["BTC","ETH","SOL",...]
    } catch (err) {
      return [];
    }
  }

  async getTokenData(token) {
    try {

      const nowSec = Math.floor(Date.now() / 1000);
      const oneHourAgo = nowSec - 3600;
      let fundingRate = 0;

      // Funding rate con fechas
      /*
      const fundingRes = await safeFetch({
        type: "fundingHistory",
        coin: token,
        startTime: oneHourAgo,
      });


      if (Array.isArray(fundingRes) && fundingRes.length > 0) {
        const latestFunding = fundingRes.reduce((a, b) =>
          a.time > b.time ? a : b
        );
        fundingRate = parseFloat(latestFunding.fundingRate ?? 0);
      }
        */
      // Meta + mercado
      const metaRes = await safeFetch({ type: "metaAndAssetCtxs" });
      const universe = metaRes?.[0]?.universe ?? [];
      const marketData = metaRes?.[1] ?? [];

      const idx = universe.findIndex((a) => a.name === token);

      const info = universe[idx];
      const market = marketData[idx];

      let bid = parseFloat(market?.impactPxs[0] ?? 0);
      let ask = parseFloat(market?.impactPxs[1] ?? 0);
      fundingRate = (parseFloat(market?.funding ?? 0)) * 100 ;
          console.log("Hyperliquid -> funding rate token " + token + ' -> ' + fundingRate )
      const oraclePx = parseFloat(market?.oraclePx ?? 0)

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
      throw err;
    }
  }
}
