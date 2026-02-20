/**
 * Stock Analyzer Extension - Stock Data Service
 *
 * Data access layer for stock market data
 * Supports Yahoo Finance API (free) with mock fallback
 */

import type {
  Stock,
  StockQuote,
  HistoricalPrice,
  TimeRange,
  StockApiConfig,
} from "../types/index.js";

/**
 * Cache entry for stock data
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Stock data service interface
 */
export interface IStockDataService {
  getStock(symbol: string): Promise<Stock | null>;
  getQuote(symbol: string): Promise<StockQuote | null>;
  getQuotes(symbols: string[]): Promise<Map<string, StockQuote>>;
  getHistoricalPrices(symbol: string, range: TimeRange): Promise<HistoricalPrice[]>;
  searchStocks(query: string): Promise<Stock[]>;
}

/**
 * Yahoo Finance API implementation
 * Uses free Yahoo Finance query APIs
 */
export class YahooFinanceService implements IStockDataService {
  private readonly config: StockApiConfig;
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly baseUrl = "https://query1.finance.yahoo.com";

  constructor(config: StockApiConfig) {
    this.config = config;
  }

  /**
   * Get stock information by symbol
   */
  async getStock(symbol: string): Promise<Stock | null> {
    const quote = await this.getQuote(symbol);
    if (!quote) return null;

    return {
      symbol: quote.symbol,
      name: `${quote.symbol} Inc.`, // Yahoo requires additional API call for name
      exchange: "NASDAQ", // Default
      currency: "USD",
      type: "common",
      isActive: true,
      createdAt: new Date(),
      updatedAt: quote.timestamp,
    };
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol: string): Promise<StockQuote | null> {
    const cacheKey = `quote:${symbol}`;
    const cached = this.getFromCache<StockQuote>(cacheKey);
    if (cached) return cached;

    try {
      const quotes = await this.fetchQuotes([symbol]);
      const quote = quotes.get(symbol);
      if (quote) {
        this.setCache(cacheKey, quote);
      }
      return quote || null;
    } catch (error) {
      console.error(`Failed to fetch quote for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get quotes for multiple symbols
   */
  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    if (!this.config.cacheEnabled) {
      return this.fetchQuotes(symbols);
    }

    const result = new Map<string, StockQuote>();
    const uncached: string[] = [];

    // Check cache for each symbol
    for (const symbol of symbols) {
      const cacheKey = `quote:${symbol}`;
      const cached = this.getFromCache<StockQuote>(cacheKey);
      if (cached) {
        result.set(symbol, cached);
      } else {
        uncached.push(symbol);
      }
    }

    // Fetch uncached quotes
    if (uncached.length > 0) {
      const freshQuotes = await this.fetchQuotes(uncached);
      for (const [symbol, quote] of freshQuotes) {
        result.set(symbol, quote);
        this.setCache(`quote:${symbol}`, quote);
      }
    }

    return result;
  }

  /**
   * Fetch quotes from Yahoo Finance API
   */
  private async fetchQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const result = new Map<string, StockQuote>();

    if (symbols.length === 0) return result;

    try {
      const symbolsParam = symbols.join(",");
      const url = `${this.baseUrl}/v7/finance/quote?symbols=${encodeURIComponent(symbolsParam)}`;

      const response = await this.fetchWithRetry(url);
      const data = (await response.json()) as {
        quoteResponse?: {
          result?: Array<{
            symbol: string;
            shortName?: string;
            regularMarketPrice?: number;
            regularMarketChange?: number;
            regularMarketChangePercent?: number;
            regularMarketOpen?: number;
            regularMarketPreviousClose?: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            regularMarketVolume?: number;
            averageDailyVolume3Month?: number;
            marketCap?: number;
            trailingPE?: number;
            fiftyTwoWeekHigh?: number;
            fiftyTwoWeekLow?: number;
          }>;
          error?: unknown;
        };
      };

      const quotes = data.quoteResponse?.result || [];

      for (const q of quotes) {
        if (q.symbol && q.regularMarketPrice !== undefined) {
          result.set(q.symbol, {
            symbol: q.symbol,
            price: q.regularMarketPrice,
            change: q.regularMarketChange || 0,
            changePercent: q.regularMarketChangePercent || 0,
            open: q.regularMarketOpen || 0,
            previousClose: q.regularMarketPreviousClose || 0,
            high: q.regularMarketDayHigh || 0,
            low: q.regularMarketDayLow || 0,
            volume: q.regularMarketVolume || 0,
            avgVolume: q.averageDailyVolume3Month || 0,
            marketCap: q.marketCap || 0,
            peRatio: q.trailingPE,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow,
            timestamp: new Date(),
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch quotes from Yahoo Finance:", error);
    }

    return result;
  }

  /**
   * Get historical price data
   */
  async getHistoricalPrices(symbol: string, range: TimeRange): Promise<HistoricalPrice[]> {
    const cacheKey = `history:${symbol}:${range}`;
    const cached = this.getFromCache<HistoricalPrice[]>(cacheKey);
    if (cached) return cached;

    const rangeToInterval = (r: TimeRange): { period1: string; interval: string } => {
      const now = Math.floor(Date.now() / 1000);
      const intervals: Record<TimeRange, { seconds: number; interval: string }> = {
        "1d": { seconds: 86400, interval: "5m" },
        "5d": { seconds: 432000, interval: "15m" },
        "1w": { seconds: 604800, interval: "1h" },
        "1m": { seconds: 2592000, interval: "1d" },
        "3m": { seconds: 7776000, interval: "1d" },
        "6m": { seconds: 15552000, interval: "1d" },
        "1y": { seconds: 31536000, interval: "1d" },
        "5y": { seconds: 157680000, interval: "1wk" },
        max: { seconds: 0, interval: "1mo" },
      };
      const config = intervals[r];
      return {
        period1: r === "max" ? "0" : String(now - config.seconds),
        interval: config.interval,
      };
    };

    try {
      const { period1, interval } = rangeToInterval(range);
      const url = `${this.baseUrl}/v8/finance/chart/${symbol}?period1=${period1}&interval=${interval}`;

      const response = await this.fetchWithRetry(url);
      const data = (await response.json()) as {
        chart?: {
          result?: Array<{
            meta?: { currency?: string };
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                open?: number[];
                high?: number[];
                low?: number[];
                close?: number[];
                volume?: number[];
              }>;
              adjclose?: Array<{ adjclose?: number[] }>;
            };
          }>;
        };
      };

      const result = data.chart?.result?.[0];
      if (!result || !result.timestamp) return [];

      const quotes = result.indicators?.quote?.[0];
      const adjClose = result.indicators?.adjclose?.[0]?.adjclose;

      const history: HistoricalPrice[] = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        if (quotes?.close?.[i] !== undefined) {
          history.push({
            symbol,
            date: new Date(result.timestamp[i] * 1000),
            open: quotes.open?.[i] || 0,
            high: quotes.high?.[i] || 0,
            low: quotes.low?.[i] || 0,
            close: quotes.close?.[i] || 0,
            volume: quotes.volume?.[i] || 0,
            adjustedClose: adjClose?.[i],
          });
        }
      }

      this.setCache(cacheKey, history);
      return history;
    } catch (error) {
      console.error(`Failed to fetch historical prices for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Search for stocks by query
   */
  async searchStocks(query: string): Promise<Stock[]> {
    try {
      const url = `${this.baseUrl}/v1/finance/search?q=${encodeURIComponent(query)}`;
      const response = await this.fetchWithRetry(url);
      const data = (await response.json()) as {
        quotes?: Array<{
          symbol: string;
          shortname?: string;
          exchange?: string;
          quoteType?: string;
        }>;
      };

      return (data.quotes || [])
        .filter((q) => q.quoteType === "EQUITY")
        .map((q) => ({
          symbol: q.symbol,
          name: q.shortname || q.symbol,
          exchange: q.exchange || "UNKNOWN",
          currency: "USD",
          type: "common" as const,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
    } catch (error) {
      console.error("Stock search failed:", error);
      return [];
    }
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; OpenClawStockAnalyzer/1.0)",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.maxRetries - 1) {
          await this.delay(1000 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error("Request failed");
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null;

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache entry
   */
  private setCache<T>(key: string, data: T): void {
    if (!this.config.cacheEnabled) return;

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.config.cacheTtl,
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Mock stock data service for testing
 */
export class MockStockDataService implements IStockDataService {
  private readonly stocks: Map<string, Stock> = new Map();
  private readonly quotes: Map<string, StockQuote> = new Map();
  private priceGenerator: Map<string, { basePrice: number; volatility: number }> = new Map();

  constructor() {
    this.initializeDefaultStocks();
  }

  private initializeDefaultStocks(): void {
    const defaultStocks = [
      { symbol: "AAPL", name: "Apple Inc.", basePrice: 175, volatility: 0.02 },
      { symbol: "GOOGL", name: "Alphabet Inc.", basePrice: 140, volatility: 0.025 },
      { symbol: "MSFT", name: "Microsoft Corporation", basePrice: 380, volatility: 0.018 },
      { symbol: "AMZN", name: "Amazon.com Inc.", basePrice: 180, volatility: 0.028 },
      { symbol: "TSLA", name: "Tesla Inc.", basePrice: 250, volatility: 0.04 },
      { symbol: "META", name: "Meta Platforms Inc.", basePrice: 500, volatility: 0.03 },
      { symbol: "NVDA", name: "NVIDIA Corporation", basePrice: 850, volatility: 0.035 },
      { symbol: "JPM", name: "JPMorgan Chase & Co.", basePrice: 195, volatility: 0.015 },
    ];

    for (const stock of defaultStocks) {
      this.stocks.set(stock.symbol, {
        symbol: stock.symbol,
        name: stock.name,
        exchange: "NASDAQ",
        currency: "USD",
        type: "common",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      this.priceGenerator.set(stock.symbol, {
        basePrice: stock.basePrice,
        volatility: stock.volatility,
      });
    }
  }

  async getStock(symbol: string): Promise<Stock | null> {
    return this.stocks.get(symbol) || null;
  }

  async getQuote(symbol: string): Promise<StockQuote | null> {
    const config = this.priceGenerator.get(symbol);
    if (!config) return null;

    const { basePrice, volatility } = config;
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    const price = basePrice * (1 + randomChange);
    const previousClose = basePrice * (1 + (Math.random() - 0.5) * volatility);
    const change = price - previousClose;
    const changePercent = (change / previousClose) * 100;

    return {
      symbol,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      open: Math.round(previousClose * (1 + (Math.random() - 0.5) * volatility * 0.5) * 100) / 100,
      previousClose: Math.round(previousClose * 100) / 100,
      high: Math.round(price * (1 + Math.random() * volatility * 0.3) * 100) / 100,
      low: Math.round(price * (1 - Math.random() * volatility * 0.3) * 100) / 100,
      volume: Math.floor(10000000 + Math.random() * 50000000),
      avgVolume: 25000000,
      marketCap: Math.round(basePrice * 1000000000),
      peRatio: 15 + Math.random() * 30,
      fiftyTwoWeekHigh: Math.round(basePrice * 1.3 * 100) / 100,
      fiftyTwoWeekLow: Math.round(basePrice * 0.7 * 100) / 100,
      timestamp: new Date(),
    };
  }

  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const result = new Map<string, StockQuote>();
    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol);
      if (quote) {
        result.set(symbol, quote);
      }
    }
    return result;
  }

  async getHistoricalPrices(symbol: string, range: TimeRange): Promise<HistoricalPrice[]> {
    const config = this.priceGenerator.get(symbol);
    if (!config) return [];

    const { basePrice, volatility } = config;
    const days = this.getDaysForRange(range);
    const history: HistoricalPrice[] = [];
    let currentPrice = basePrice * (1 - volatility * (days / 365));

    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      const dailyChange = (Math.random() - 0.5) * 2 * volatility * (basePrice / 20);
      currentPrice = Math.max(currentPrice + dailyChange, basePrice * 0.5);

      const open = currentPrice * (1 + (Math.random() - 0.5) * volatility * 0.2);
      const close = currentPrice;
      const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.1);
      const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.1);

      history.push({
        symbol,
        date,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.floor(10000000 + Math.random() * 50000000),
      });
    }

    return history;
  }

  async searchStocks(query: string): Promise<Stock[]> {
    const q = query.toLowerCase();
    const results: Stock[] = [];

    for (const stock of this.stocks.values()) {
      if (stock.symbol.toLowerCase().includes(q) || stock.name.toLowerCase().includes(q)) {
        results.push(stock);
      }
    }

    return results;
  }

  private getDaysForRange(range: TimeRange): number {
    const days: Record<TimeRange, number> = {
      "1d": 1,
      "5d": 5,
      "1w": 7,
      "1m": 30,
      "3m": 90,
      "6m": 180,
      "1y": 365,
      "5y": 1825,
      max: 3650,
    };
    return days[range];
  }
}

/**
 * Create stock data service based on config
 */
export function createStockDataService(config: StockApiConfig): IStockDataService {
  switch (config.provider) {
    case "yahoo":
      return new YahooFinanceService(config);
    case "mock":
      return new MockStockDataService();
    case "alpha_vantage":
      // Alpha Vantage would require an API key
      // For now, fall back to mock
      console.warn("Alpha Vantage not implemented, using mock service");
      return new MockStockDataService();
    default:
      return new MockStockDataService();
  }
}
