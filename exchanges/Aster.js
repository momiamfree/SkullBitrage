import fetch from "node-fetch";

const BASE_URL = "https://fapi.asterdex.com/fapi/v1";

async function safeFetch(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Error fetch ${url}: ${resp.status}`);
  return resp.json();
}

export default class Aster {
  constructor() {
    this.name = "Aster";
    this.baseUrl = BASE_URL;
    this.cachedTokens = null; // guardamos aquí la lista
  }

  // 🔹 Nuevo método: devuelve lista de tokens disponibles
  async getAvailableTokens(quote = "USDT") {
    if (this.cachedTokens) return this.cachedTokens;

    const data = await safeFetch(`${this.baseUrl}/ticker/24hr`);
    // Filtramos solo los símbolos que terminan en USDT
    const tokens = data
      .map(d => d.symbol)
      .filter(sym => sym.endsWith(quote))
      .map(sym => sym.replace(quote, "")); // ej: "STBLUSDT" → "STBL"

    this.cachedTokens = tokens;
    return tokens;
  }

  async getTokenData(token, quote = "USDT") {
    const symbol = `${token}${quote}`;
    const now = Date.now();

    console.log('Aster procesando ' + symbol )
    let fundingRate = 0;
    // 1️⃣ Funding
    fundingRate = await safeFetch(
      `${this.baseUrl}/premiumIndex?symbol=${symbol}`
    );

    fundingRate = ((fundingRate?.lastFundingRate ?? 0) * 100);

    console.log("Aster funding rate token " + token + ' -> ' + fundingRate  )
  
    // 2️⃣ OI, volumen y libro
    const [oi, vol, book] = await Promise.all([
      safeFetch(`${this.baseUrl}/openInterest?symbol=${symbol}`),
      safeFetch(`${this.baseUrl}/ticker/24hr?symbol=${symbol}`),
      safeFetch(`${this.baseUrl}/ticker/bookTicker?symbol=${symbol}`),
    ]);

    let bid = parseFloat(book?.bidPrice ?? 0);
    let ask = parseFloat(book?.askPrice ?? 0);
    const midPrice =
      bid && ask ? (bid + ask) / 2 : parseFloat(vol?.lastPrice ?? 0);

    const openInterestBTC = parseFloat(oi?.openInterest ?? 0);
    const volumeBTC = parseFloat(vol?.volume ?? 0);

    return {
      exchange: this.name,
      token,
      fundingRate,
      openInterest: openInterestBTC * midPrice,
      volume: volumeBTC * midPrice,
      bid,
      ask,
      midPrice,
    };
  }
}
