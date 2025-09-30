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
    this.cachedTokens = null;
    this.lastNextFunding = {}; // 🔹 guardamos el último nextFundingTime por token
  }

  async getAvailableTokens(quote = "USDT") {
    if (this.cachedTokens) return this.cachedTokens;
    const data = await safeFetch(`${this.baseUrl}/ticker/24hr`);
    const tokens = data
      .map(d => d.symbol)
      .filter(sym => sym.endsWith(quote))
      .map(sym => sym.replace(quote, ""));
    this.cachedTokens = tokens;
    return tokens;
  }

  async getTokenData(token, quote = "USDT") {
    const symbol = `${token}${quote}`;

    // 1️⃣ Funding
    const fundingInfo = await safeFetch(`${this.baseUrl}/premiumIndex?symbol=${symbol}`);
    const rawFunding = parseFloat(fundingInfo?.lastFundingRate ?? 0);
    const nextFundingTime = fundingInfo?.nextFundingTime;

    // Detectar intervalo real (en horas)
    let hours = 8; // por defecto
    if (this.lastNextFunding[token]) {
      const diffMs = nextFundingTime - this.lastNextFunding[token];
      const h = diffMs / (1000 * 60 * 60);
      if (h > 0) {
        hours = h;
      }
    }
    this.lastNextFunding[token] = nextFundingTime;

    // Normalizar funding a 1h
    const fundingPerHour = hours > 0 ? rawFunding / hours : rawFunding;
    const fundingRate = fundingPerHour * 100; // en %

    console.log(`Aster funding rate token ${token} -> ${fundingRate.toFixed(6)}% (cada ${hours}h)`);

    // 2️⃣ OI, volumen y libro
    const [oi, vol, book] = await Promise.all([
      safeFetch(`${this.baseUrl}/openInterest?symbol=${symbol}`),
      safeFetch(`${this.baseUrl}/ticker/24hr?symbol=${symbol}`),
      safeFetch(`${this.baseUrl}/ticker/bookTicker?symbol=${symbol}`),
    ]);

    let bid = parseFloat(book?.bidPrice ?? 0);
    let ask = parseFloat(book?.askPrice ?? 0);
    const midPrice = bid && ask ? (bid + ask) / 2 : parseFloat(vol?.lastPrice ?? 0);

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
