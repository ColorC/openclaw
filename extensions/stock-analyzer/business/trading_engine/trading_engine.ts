/**
 * Trading Engine
 * Main orchestration layer that coordinates trading operations
 */

import { IStockDataProvider } from "../../data/stock_data_client/stock_data_provider";
import {
  AccountId,
  TransactionType,
  OrderStatus,
  TransactionRecord,
} from "../../data/trading_repository/trading_data_models";
import { ITradingDataRepository } from "../../data/trading_repository/trading_data_repository";
import { AccountService } from "./account_service";
import { AnalyticsService } from "./analytics_service";
import { PortfolioService } from "./portfolio_service";
import {
  AccountConfig,
  AccountInfo,
  BuyOrderRequest,
  SellOrderRequest,
  OrderResult,
  PortfolioView,
  TransactionHistoryView,
  PerformanceReport,
  StockSearchResult,
  StockQuoteView,
} from "./trading_types";

/**
 * Trading Service Interface
 * Main interface for trading operations
 */
export interface ITradingService {
  // Account operations
  createAccount(config: AccountConfig): Promise<AccountInfo>;
  getAccountInfo(accountId: AccountId): Promise<AccountInfo | null>;
  getAllAccounts(): Promise<AccountInfo[]>;
  deleteAccount(accountId: AccountId): Promise<boolean>;

  // Trading operations
  executeBuyOrder(request: BuyOrderRequest): Promise<OrderResult>;
  executeSellOrder(request: SellOrderRequest): Promise<OrderResult>;

  // Portfolio operations
  getPortfolio(accountId: AccountId): Promise<PortfolioView>;

  // History and analytics
  getTransactionHistory(
    accountId: AccountId,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ): Promise<TransactionHistoryView>;
  getPerformanceMetrics(accountId: AccountId): Promise<PerformanceReport>;

  // Market data
  searchStocks(query: string, limit?: number): Promise<StockSearchResult[]>;
  getStockQuote(stockCode: string): Promise<StockQuoteView>;
}

/**
 * Trading Engine
 * Main implementation of trading service
 */
export class TradingEngine implements ITradingService {
  private accountService: AccountService;
  private portfolioService: PortfolioService;
  private analyticsService: AnalyticsService;
  private stockDataProvider: IStockDataProvider;

  constructor(repository: ITradingDataRepository, stockDataProvider: IStockDataProvider) {
    this.stockDataProvider = stockDataProvider;
    this.accountService = new AccountService(repository);
    this.portfolioService = new PortfolioService(repository, stockDataProvider);
    this.analyticsService = new AnalyticsService(repository, stockDataProvider);
  }

  /**
   * Create a new simulated trading account
   */
  async createAccount(config: AccountConfig): Promise<AccountInfo> {
    if (!config.name || config.name.trim() === "") {
      throw new Error("Account name is required");
    }
    if (config.initialBalance < 0) {
      throw new Error("Initial balance must be non-negative");
    }

    return this.accountService.createAccount(config);
  }

  /**
   * Get account information
   */
  async getAccountInfo(accountId: AccountId): Promise<AccountInfo | null> {
    return this.accountService.getAccountInfo(accountId);
  }

  /**
   * Get all accounts
   */
  async getAllAccounts(): Promise<AccountInfo[]> {
    return this.accountService.getAllAccounts();
  }

  /**
   * Delete an account
   */
  async deleteAccount(accountId: AccountId): Promise<boolean> {
    return this.accountService.deleteAccount(accountId);
  }

  /**
   * Execute a buy order
   */
  async executeBuyOrder(request: BuyOrderRequest): Promise<OrderResult> {
    try {
      // Validate account exists
      const account = await this.accountService.getAccountInfo(request.accountId);
      if (!account) {
        return this.createErrorResult(
          request,
          TransactionType.BUY,
          `Account not found: ${request.accountId}`,
        );
      }

      // Validate quantity
      if (request.quantity <= 0) {
        return this.createErrorResult(
          request,
          TransactionType.BUY,
          "Quantity must be greater than 0",
        );
      }

      // Get current stock price
      const quote = await this.stockDataProvider.getQuote(request.stockCode);
      const executionPrice = quote.price;

      // Check max price constraint
      if (request.maxPrice && executionPrice > request.maxPrice) {
        return this.createErrorResult(
          request,
          TransactionType.BUY,
          `Current price ${executionPrice} exceeds max price ${request.maxPrice}`,
        );
      }

      // Calculate total amount
      const totalAmount = executionPrice * request.quantity;

      // Check sufficient balance
      const hasBalance = await this.accountService.hasSufficientBalance(
        request.accountId,
        totalAmount,
      );
      if (!hasBalance) {
        return this.createErrorResult(
          request,
          TransactionType.BUY,
          `Insufficient balance. Required: ${totalAmount.toFixed(2)}, Available: ${account.balance.toFixed(2)}`,
        );
      }

      // Deduct balance
      await this.accountService.updateBalance(request.accountId, -totalAmount);

      // Add shares to portfolio
      await this.portfolioService.addShares(
        request.accountId,
        request.stockCode,
        request.quantity,
        executionPrice,
      );

      // Record transaction
      const transaction: TransactionRecord = {
        id: "",
        accountId: request.accountId,
        stockCode: request.stockCode.toUpperCase(),
        type: TransactionType.BUY,
        quantity: request.quantity,
        price: executionPrice,
        totalAmount,
        status: OrderStatus.EXECUTED,
        timestamp: new Date(),
        notes: request.notes,
      };
      const txId = await (this.accountService as any).repository.saveTransaction(transaction);

      // Update portfolio value
      const portfolio = await this.portfolioService.getPortfolio(request.accountId);
      await this.accountService.updatePortfolioValue(request.accountId, portfolio.totalMarketValue);

      return {
        success: true,
        transactionId: txId,
        stockCode: request.stockCode.toUpperCase(),
        orderType: TransactionType.BUY,
        quantity: request.quantity,
        executionPrice,
        totalAmount,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createErrorResult(
        request,
        TransactionType.BUY,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * Execute a sell order
   */
  async executeSellOrder(request: SellOrderRequest): Promise<OrderResult> {
    try {
      // Validate account exists
      const account = await this.accountService.getAccountInfo(request.accountId);
      if (!account) {
        return this.createErrorResult(
          request,
          TransactionType.SELL,
          `Account not found: ${request.accountId}`,
        );
      }

      // Validate quantity
      if (request.quantity <= 0) {
        return this.createErrorResult(
          request,
          TransactionType.SELL,
          "Quantity must be greater than 0",
        );
      }

      // Check sufficient shares
      const hasShares = await this.portfolioService.hasSufficientShares(
        request.accountId,
        request.stockCode,
        request.quantity,
      );
      if (!hasShares) {
        const currentQty = await this.portfolioService.getHoldingQuantity(
          request.accountId,
          request.stockCode,
        );
        return this.createErrorResult(
          request,
          TransactionType.SELL,
          `Insufficient shares. Available: ${currentQty}, Requested: ${request.quantity}`,
        );
      }

      // Get current stock price
      const quote = await this.stockDataProvider.getQuote(request.stockCode);
      const executionPrice = quote.price;

      // Check min price constraint
      if (request.minPrice && executionPrice < request.minPrice) {
        return this.createErrorResult(
          request,
          TransactionType.SELL,
          `Current price ${executionPrice} is below min price ${request.minPrice}`,
        );
      }

      // Calculate total amount
      const totalAmount = executionPrice * request.quantity;

      // Remove shares from portfolio and get average cost
      const result = await this.portfolioService.removeShares(
        request.accountId,
        request.stockCode,
        request.quantity,
      );

      // Add balance
      await this.accountService.updateBalance(request.accountId, totalAmount);

      // Record transaction
      const transaction: TransactionRecord = {
        id: "",
        accountId: request.accountId,
        stockCode: request.stockCode.toUpperCase(),
        type: TransactionType.SELL,
        quantity: request.quantity,
        price: executionPrice,
        totalAmount,
        status: OrderStatus.EXECUTED,
        timestamp: new Date(),
        notes: request.notes,
      };
      const txId = await (this.accountService as any).repository.saveTransaction(transaction);

      // Update portfolio value
      const portfolio = await this.portfolioService.getPortfolio(request.accountId);
      await this.accountService.updatePortfolioValue(request.accountId, portfolio.totalMarketValue);

      return {
        success: true,
        transactionId: txId,
        stockCode: request.stockCode.toUpperCase(),
        orderType: TransactionType.SELL,
        quantity: request.quantity,
        executionPrice,
        totalAmount,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createErrorResult(
        request,
        TransactionType.SELL,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * Get portfolio view
   */
  async getPortfolio(accountId: AccountId): Promise<PortfolioView> {
    return this.portfolioService.getPortfolio(accountId);
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    accountId: AccountId,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ): Promise<TransactionHistoryView> {
    const result = await this.analyticsService.getTransactionHistory(
      accountId,
      startDate,
      endDate,
      limit,
    );

    return {
      accountId,
      transactions: result.transactions,
      totalCount: result.totalCount,
    };
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(accountId: AccountId): Promise<PerformanceReport> {
    return this.analyticsService.getPerformanceMetrics(accountId);
  }

  /**
   * Search stocks
   */
  async searchStocks(query: string, limit?: number): Promise<StockSearchResult[]> {
    const results = await this.stockDataProvider.searchStocks({
      query,
      limit: limit || 10,
    });

    return results.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      exchange: s.exchange,
      price: s.price,
      change: s.change,
      changePercent: s.price > 0 ? (s.change / s.price) * 100 : 0,
    }));
  }

  /**
   * Get stock quote
   */
  async getStockQuote(stockCode: string): Promise<StockQuoteView> {
    const quote = await this.stockDataProvider.getQuote(stockCode);

    return {
      symbol: quote.symbol,
      companyName: quote.companyName,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      previousClose: quote.previousClose,
      high: quote.high,
      low: quote.low,
      open: quote.open,
      timestamp: quote.timestamp,
    };
  }

  /**
   * Create error result helper
   */
  private createErrorResult(
    request: BuyOrderRequest | SellOrderRequest,
    orderType: TransactionType,
    error: string,
  ): OrderResult {
    return {
      success: false,
      error,
      stockCode: request.stockCode.toUpperCase(),
      orderType,
      quantity: request.quantity,
      executionPrice: 0,
      totalAmount: 0,
      timestamp: new Date(),
    };
  }
}
