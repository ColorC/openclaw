/**
 * Stock Data Types
 * Type definitions for stock market data structures
 */

/**
 * Stock code identifier (e.g., "AAPL", "TSLA")
 */
export type StockCode = string;

/**
 * Market code identifier (e.g., "NASDAQ", "NYSE", "SSE")
 */
export type MarketCode = string;

/**
 * Stock quote with real-time/delayed price information
 */
export interface StockQuote {
  /** Stock ticker symbol */
  symbol: StockCode;
  /** Current price */
  price: number;
  /** Price change from previous close */
  change: number;
  /** Percentage change from previous close */
  changePercent: number;
  /** Trading volume */
  volume: number;
  /** Previous day's closing price */
  previousClose: number;
  /** Day's high price */
  high: number;
  /** Day's low price */
  low: number;
  /** Day's opening price */
  open: number;
  /** Timestamp of the quote */
  timestamp: Date;
  /** Full company name */
  companyName?: string;
}

/**
 * Stock summary for search results
 */
export interface StockSummary {
  /** Stock ticker symbol */
  symbol: StockCode;
  /** Company name */
  name: string;
  /** Stock exchange */
  exchange: string;
  /** Current price */
  price: number;
  /** Price change */
  change: number;
}

/**
 * List of stock summaries from search
 */
export type StockSummaryList = StockSummary[];

/**
 * Map of stock codes to quotes for batch queries
 */
export type StockQuoteMap = Map<StockCode, StockQuote>;

/**
 * List of stock codes for batch operations
 */
export type StockCodeList = StockCode[];

/**
 * Search query parameters
 */
export interface SearchQuery {
  /** Search text (stock code or company name) */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Market status information
 */
export interface MarketStatus {
  /** Market code */
  market: MarketCode;
  /** Whether the market is currently open */
  isOpen: boolean;
  /** Current market session (e.g., "regular", "pre", "after") */
  session?: string;
  /** Next market open time */
  nextOpen?: Date;
  /** Next market close time */
  nextClose?: Date;
}

/**
 * Configuration for stock data provider
 */
export interface StockDataProviderConfig {
  /** API key for the data provider */
  apiKey?: string;
  /** API endpoint base URL */
  baseUrl?: string;
  /** Enable caching */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
}
