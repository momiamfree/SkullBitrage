import fetch from "node-fetch";

const BASE_URL = "https://api.pacifica.fi/api/v1";

async function safeFetch(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error fetch ${url}: ${resp.status}`);
  return resp.json();
}

export default class Pacifica {
  constructor() {
    this.name = "Pacifica";
    this.baseUrl = BASE_URL;
    this.cachedTokens = null;
  }

  // 🔹 Lista de tokens disponibles
  async getAvailableTokens() {
    if (this.cachedTokens) return this.cachedTokens;

    const data = await safeFetch(`${this.baseUrl}/info`);
    const tokens = data?.data?.map(d => d.symbol) || [];

    this.cachedTokens = tokens;
    return tokens;
  }

  // 🔹 Datos de un token específico
  async getTokenData(token) {
    // precios, OI y volumen
    const pricesResp = await safeFetch(`${this.baseUrl}/info/prices`);
    const info = pricesResp?.data?.find(d => d.symbol === token);

    if (!info) throw new Error(`Pacifica: token ${token} no encontrado`);

    // funding rate (ya es 1h)
    const fundingRate = parseFloat(info.funding ?? 0) * 100; // en %
          console.log("Pacifica -> funding rate token " + token + ' -> ' + fundingRate )
    // volumen y OI
    const openInterest = parseFloat(info.open_interest ?? 0);
    const volume = parseFloat(info.volume_24h ?? 0);

    // libro de órdenes (bid/ask reales)
    const bookResp = await safeFetch(`${this.baseUrl}/book?symbol=${token}`);
    const bids = bookResp?.data?.l?.[0] ?? [];
    const asks = bookResp?.data?.l?.[1] ?? [];

    const bid = bids.length ? parseFloat(bids[0].p) : parseFloat(info.mid ?? info.mark ?? 0);
    const ask = asks.length ? parseFloat(asks[0].p) : parseFloat(info.mid ?? info.mark ?? 0);
    const midPrice = (bid && ask) ? (bid + ask) / 2 : parseFloat(info.mid ?? info.mark ?? 0);

    return {
      exchange: this.name,
      token,
      fundingRate,
      openInterest: openInterest * midPrice, // lo pasamos a $
      volume: volume,                        // ya está en $ (según docs es 24h en notional)
      bid,
      ask,
      midPrice,
    };
  }
}
