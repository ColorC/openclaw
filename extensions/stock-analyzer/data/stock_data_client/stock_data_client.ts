/**
 * Stock Data Client
 * Implementation of IStockDataProvider with caching and mock data
 */

import { IStockDataProvider } from "./stock_data_provider";
import {
  StockCode,
  StockQuote,
  StockSummaryList,
  StockCodeList,
  StockQuoteMap,
  SearchQuery,
  StockDataProviderConfig,
  StockSummary,
} from "./stock_data_types";

/**
 * Stock Data Client
 * Fetches stock market data from external API with caching support
 */
export class StockDataClient implements IStockDataProvider {
  private config: StockDataProviderConfig;
  private cache: Map<string, { data: StockQuote; timestamp: number }>;
  private mockData: Map<StockCode, StockQuote>;

  constructor(config?: StockDataProviderConfig) {
    this.config = {
      apiKey: config?.apiKey || "",
      baseUrl: config?.baseUrl || "",
      enableCache: config?.enableCache ?? true,
      cacheTtl: config?.cacheTtl || 60000, // 1 minute default
      timeout: config?.timeout || 5000,
    };
    this.cache = new Map();
    this.mockData = this.initializeMockData();
  }

  /**
   * Initialize mock data for demonstration
   */
  private initializeMockData(): Map<StockCode, StockQuote> {
    const data = new Map<StockCode, StockQuote>();
    const now = new Date();

    // Popular stocks mock data
    const stocks = [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        price: 178.5,
        change: 2.35,
        volume: 50000000,
        previousClose: 176.15,
        high: 179.2,
        low: 175.8,
        open: 176.5,
      },
      {
        symbol: "GOOGL",
        name: "Alphabet Inc.",
        price: 141.25,
        change: -1.15,
        volume: 25000000,
        previousClose: 142.4,
        high: 143.0,
        low: 140.5,
        open: 142.2,
      },
      {
        symbol: "MSFT",
        name: "Microsoft Corporation",
        price: 378.9,
        change: 4.2,
        volume: 30000000,
        previousClose: 374.7,
        high: 380.5,
        low: 374.0,
        open: 375.0,
      },
      {
        symbol: "AMZN",
        name: "Amazon.com Inc.",
        price: 178.25,
        change: 3.15,
        volume: 40000000,
        previousClose: 175.1,
        high: 179.8,
        low: 174.5,
        open: 175.5,
      },
      {
        symbol: "TSLA",
        name: "Tesla Inc.",
        price: 248.5,
        change: -5.8,
        volume: 80000000,
        previousClose: 254.3,
        high: 255.0,
        low: 247.2,
        open: 253.8,
      },
    ];

    for (const stock of stocks) {
      data.set(stock.symbol, {
        symbol: stock.symbol,
        price: stock.price,
        change: stock.change,
        changePercent: (stock.change / stock.previousClose) * 100,
        volume: stock.volume,
        previousClose: stock.previousClose,
        high: stock.high,
        low: stock.low,
        open: stock.open,
        timestamp: now,
        companyName: stock.name,
      });
    }

    return data;
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < (this.config.cacheTtl || 60000);
  }

  /**
   * Get cached quote if available and valid
   */
  private getCachedQuote(stockCode: string): StockQuote | null {
    if (!this.config.enableCache) {
      return null;
    }

    const cached = this.cache.get(stockCode);
    if (cached && this.isCacheValid(cached.timestamp)) {
      return cached.data;
    }

    return null;
  }

  /**
   * Set cache for a stock quote
   */
  private setCache(stockCode: string, data: StockQuote): void {
    if (this.config.enableCache) {
      this.cache.set(stockCode, { data, timestamp: Date.now() });
    }
  }

  /**
   * Fetch current stock quote
   */
  async getQuote(stockCode: StockCode): Promise<StockQuote> {
    const upperCode = stockCode.toUpperCase();

    // Check cache first
    const cached = this.getCachedQuote(upperCode);
    if (cached) {
      return cached;
    }

    // Fetch from mock data (would be API call in production)
    const quote = this.mockData.get(upperCode);
    if (!quote) {
      throw new Error(`Stock not found: ${stockCode}`);
    }

    // Update timestamp and add random variation for realism
    const updatedQuote: StockQuote = {
      ...quote,
      timestamp: new Date(),
      price: quote.price + (Math.random() - 0.5) * 2,
    };
    updatedQuote.change = updatedQuote.price - updatedQuote.previousClose;
    updatedQuote.changePercent = (updatedQuote.change / updatedQuote.previousClose) * 100;

    this.setCache(upperCode, updatedQuote);
    return updatedQuote;
  }

  /**
   * Search stocks by name or code pattern
   */
  async searchStocks(query: SearchQuery): Promise<StockSummaryList> {
    const results: StockSummary[] = [];
    const searchQuery = query.query.toLowerCase();
    const limit = query.limit || 10;

    for (const [symbol, quote] of this.mockData.entries()) {
      const name = (quote.companyName || "").toLowerCase();
      const code = symbol.toLowerCase();

      if (code.includes(searchQuery) || name.includes(searchQuery)) {
        results.push({
          symbol,
          name: quote.companyName || symbol,
          exchange: "NASDAQ",
          price: quote.price,
          change: quote.change,
        });
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  /**
   * Fetch multiple stock quotes in a single call
   */
  async getBatchQuotes(stockCodes: StockCodeList): Promise<StockQuoteMap> {
    const quotes = new Map<StockCode, StockQuote>();

    for (const code of stockCodes) {
      try {
        const quote = await this.getQuote(code);
        quotes.set(code, quote);
      } catch (error) {
        // Skip stocks not found
        console.warn(`Failed to fetch quote for ${code}:`, error);
      }
    }

    return quotes;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
