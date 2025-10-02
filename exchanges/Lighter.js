// exchanges/Lighter.js
import fetch from "node-fetch";

const BASE_URL = "https://mainnet.zklighter.elliot.ai/api/v1";

async function safeFetch(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error fetch ${url}: ${resp.status}`);
  return resp.json();
}

export default class Lighter {
  constructor() {
    this.name = "Lighter";
    this.baseUrl = BASE_URL;
  }

  async getTokenData(token) {
    try {
      // 1️⃣ Buscar market_id dinámicamente en orderBookDetails
      const detailsRes = await safeFetch(`${this.baseUrl}/orderBookDetails`);
      const details = detailsRes?.order_book_details ?? [];
      const market = details.find((d) => d.symbol === token);
      if (!market) return null;

      const marketId = market.market_id;
      const lastPrice = parseFloat(market.last_trade_price ?? 0);
      const openInterestToken = parseFloat(market.open_interest ?? 0);
      const openInterestUSD = openInterestToken * lastPrice;
      const volume = parseFloat(market.daily_quote_token_volume ?? 0);

      // 2️⃣ Funding rate dinámico (última hora, elegir el más actual)
      const endTime = Math.floor(Date.now() / 1000) + 14400; // segundos
      const startTime = Date.now() + 7200;

      const fundingRes = await safeFetch(
        `${this.baseUrl}/fundings?market_id=${marketId}&resolution=1h&start_timestamp=${startTime}&end_timestamp=${endTime}&count_back=10`
      );

      let fundingRate = 0;
      if (fundingRes?.fundings?.length > 0) {
        const latest = fundingRes.fundings.reduce((a, b) =>
          a.timestamp > b.timestamp ? a : b
        );
        fundingRate = parseFloat(latest.rate ?? 0);

        // 👇 Ajustar signo según direction
        if (latest.direction?.toLowerCase() === "short") {
          fundingRate = -Math.abs(fundingRate);
        } else if (latest.direction?.toLowerCase() === "long") {
          fundingRate = Math.abs(fundingRate);
        }
        console.log(
          `Lighter funding rate token ${token} -> ${fundingRate} (dir=${latest.direction})`
        );
      }

      // 3️⃣ Obtener mejor bid/ask real de orderBookOrders
      const orderRes = await safeFetch(
        `${this.baseUrl}/orderBookOrders?market_id=${marketId}&limit=1`
      );

      const bestAsk = orderRes.asks?.[0]?.price
        ? parseFloat(orderRes.asks[0].price)
        : null;
      const bestBid = orderRes.bids?.[0]?.price
        ? parseFloat(orderRes.bids[0].price)
        : null;

      return {
        exchange: this.name,
        token: market.symbol || token,
        fundingRate,
        openInterest: openInterestUSD,
        volume,
        bid: bestBid,
        ask: bestAsk,
        midPrice: bestBid && bestAsk ? (bestBid + bestAsk) / 2 : lastPrice,
      };
    } catch (err) {
      console.log("LIGHTER ERROR ->", err.message || err);
      return null;
    }
  }
}
