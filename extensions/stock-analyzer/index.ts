/**
 * Stock Analyzer Extension
 * Main entry point for the stock analyzer extension
 */

// Data Layer
export { StockDataClient } from "./data/stock_data_client/stock_data_client";
export { IStockDataProvider } from "./data/stock_data_client/stock_data_provider";
export * from "./data/stock_data_client/stock_data_types";

export { TradingRepository } from "./data/trading_repository/trading_repository";
export { ITradingDataRepository } from "./data/trading_repository/trading_data_repository";
export * from "./data/trading_repository/trading_data_models";

// Business Layer
export { TradingEngine, ITradingService } from "./business/trading_engine/trading_engine";
export { AccountService } from "./business/trading_engine/account_service";
export { PortfolioService } from "./business/trading_engine/portfolio_service";
export { AnalyticsService } from "./business/trading_engine/analytics_service";
export * from "./business/trading_engine/trading_types";

// Presentation Layer
export { TradingUI } from "./presentation/trading_ui/trading_ui";
export * from "./presentation/trading_ui/ui_types";

/**
 * Create a complete trading system instance
 * Factory function to create all components with proper wiring
 */
export function createTradingSystem(config?: { apiKey?: string; baseUrl?: string }) {
  // Create data layer components
  const stockDataClient = new StockDataClient({
    apiKey: config?.apiKey,
    baseUrl: config?.baseUrl,
  });

  const tradingRepository = new TradingRepository();

  // Create business layer
  const tradingEngine = new TradingEngine(tradingRepository, stockDataClient);

  // Create presentation layer
  const tradingUI = new TradingUI(tradingEngine);

  return {
    stockDataClient,
    tradingRepository,
    tradingEngine,
    tradingUI,
  };
}

/**
 * Extension metadata
 */
export const extensionInfo = {
  name: "stock-analyzer",
  version: "1.0.0",
  description: "Stock market simulation and trading analysis tool",
  author: "OpenClaw",
  capabilities: [
    "account_management",
    "stock_quotes",
    "paper_trading",
    "portfolio_tracking",
    "performance_analytics",
  ],
};
