/**
 * Portfolio Service
 * Manages portfolio holdings and position updates
 */

import { IStockDataProvider } from "../../data/stock_data_client/stock_data_provider";
import {
  AccountId,
  StockCode,
  PortfolioData,
  PortfolioHolding,
} from "../../data/trading_repository/trading_data_models";
import { ITradingDataRepository } from "../../data/trading_repository/trading_data_repository";
import { PortfolioView, PortfolioHoldingView } from "./trading_types";

/**
 * Portfolio Service
 * Handles portfolio tracking and valuation
 */
export class PortfolioService {
  private repository: ITradingDataRepository;
  private stockDataProvider: IStockDataProvider;

  constructor(repository: ITradingDataRepository, stockDataProvider: IStockDataProvider) {
    this.repository = repository;
    this.stockDataProvider = stockDataProvider;
  }

  /**
   * Get portfolio with current market values
   */
  async getPortfolio(accountId: AccountId): Promise<PortfolioView> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const portfolio = await this.repository.loadPortfolio(accountId);
    const holdings = portfolio?.holdings || [];

    // Fetch current prices for all holdings
    const stockCodes = holdings.map((h) => h.stockCode);
    const quotes = await this.stockDataProvider.getBatchQuotes(stockCodes);

    // Calculate holdings views with current values
    const holdingViews: PortfolioHoldingView[] = [];
    let totalCost = 0;
    let totalMarketValue = 0;

    for (const holding of holdings) {
      const quote = quotes.get(holding.stockCode);
      const currentPrice = quote?.price || holding.averageCost;
      const marketValue = currentPrice * holding.quantity;
      const unrealizedPnL = marketValue - holding.totalCost;

      holdingViews.push({
        stockCode: holding.stockCode,
        companyName: quote?.companyName,
        quantity: holding.quantity,
        averageCost: holding.averageCost,
        totalCost: holding.totalCost,
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent: holding.totalCost > 0 ? (unrealizedPnL / holding.totalCost) * 100 : 0,
      });

      totalCost += holding.totalCost;
      totalMarketValue += marketValue;
    }

    const totalUnrealizedPnL = totalMarketValue - totalCost;

    return {
      accountId,
      holdings: holdingViews,
      totalCost,
      totalMarketValue,
      totalUnrealizedPnL,
      totalUnrealizedPnLPercent: totalCost > 0 ? (totalUnrealizedPnL / totalCost) * 100 : 0,
      availableBalance: account.balance,
      totalValue: account.balance + totalMarketValue,
    };
  }

  /**
   * Add shares to portfolio (buy)
   */
  async addShares(
    accountId: AccountId,
    stockCode: StockCode,
    quantity: number,
    price: number,
  ): Promise<void> {
    const portfolio = await this.repository.loadPortfolio(accountId);
    const holdings = portfolio?.holdings || [];

    const existingIndex = holdings.findIndex((h) => h.stockCode === stockCode.toUpperCase());

    if (existingIndex >= 0) {
      // Update existing holding
      const existing = holdings[existingIndex];
      const newQuantity = existing.quantity + quantity;
      const newTotalCost = existing.totalCost + quantity * price;

      holdings[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        totalCost: newTotalCost,
        averageCost: newTotalCost / newQuantity,
        updatedAt: new Date(),
      };
    } else {
      // Create new holding
      holdings.push({
        stockCode: stockCode.toUpperCase(),
        quantity,
        averageCost: price,
        totalCost: quantity * price,
        updatedAt: new Date(),
      });
    }

    await this.repository.savePortfolio(accountId, {
      accountId,
      holdings,
      updatedAt: new Date(),
    });
  }

  /**
   * Remove shares from portfolio (sell)
   */
  async removeShares(
    accountId: AccountId,
    stockCode: StockCode,
    quantity: number,
  ): Promise<{ averageCost: number; success: boolean }> {
    const portfolio = await this.repository.loadPortfolio(accountId);
    const holdings = portfolio?.holdings || [];

    const existingIndex = holdings.findIndex((h) => h.stockCode === stockCode.toUpperCase());

    if (existingIndex < 0) {
      throw new Error(`No holdings found for ${stockCode}`);
    }

    const existing = holdings[existingIndex];

    if (existing.quantity < quantity) {
      throw new Error(
        `Insufficient shares. Available: ${existing.quantity}, Requested: ${quantity}`,
      );
    }

    const averageCost = existing.averageCost;
    const newQuantity = existing.quantity - quantity;

    if (newQuantity === 0) {
      // Remove holding completely
      holdings.splice(existingIndex, 1);
    } else {
      // Reduce holding
      const removedCost = quantity * averageCost;
      holdings[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        totalCost: existing.totalCost - removedCost,
        updatedAt: new Date(),
      };
    }

    await this.repository.savePortfolio(accountId, {
      accountId,
      holdings,
      updatedAt: new Date(),
    });

    return { averageCost, success: true };
  }

  /**
   * Get holding quantity for a stock
   */
  async getHoldingQuantity(accountId: AccountId, stockCode: StockCode): Promise<number> {
    const portfolio = await this.repository.loadPortfolio(accountId);
    const holdings = portfolio?.holdings || [];

    const holding = holdings.find((h) => h.stockCode === stockCode.toUpperCase());
    return holding?.quantity || 0;
  }

  /**
   * Check if portfolio has sufficient shares
   */
  async hasSufficientShares(
    accountId: AccountId,
    stockCode: StockCode,
    quantity: number,
  ): Promise<boolean> {
    const currentQuantity = await this.getHoldingQuantity(accountId, stockCode);
    return currentQuantity >= quantity;
  }
}
