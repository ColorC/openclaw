/**
 * Stock Data Provider Interface
 * Interface for fetching stock market data from external providers
 */

import {
  StockCode,
  StockQuote,
  StockSummaryList,
  StockCodeList,
  StockQuoteMap,
  SearchQuery,
} from "./stock_data_types";

/**
 * Interface for stock data provider
 * Implements adapter pattern for external stock data APIs
 */
export interface IStockDataProvider {
  /**
   * Fetch current stock quote
   * @param stockCode Stock ticker symbol
   * @returns Promise resolving to stock quote
   */
  getQuote(stockCode: StockCode): Promise<StockQuote>;

  /**
   * Search stocks by name or code pattern
   * @param query Search query parameters
   * @returns Promise resolving to list of matching stock summaries
   */
  searchStocks(query: SearchQuery): Promise<StockSummaryList>;

  /**
   * Fetch multiple stock quotes in a single API call
   * Useful for portfolio valuation
   * @param stockCodes List of stock codes to fetch
   * @returns Promise resolving to map of stock codes to quotes
   */
  getBatchQuotes(stockCodes: StockCodeList): Promise<StockQuoteMap>;
}
