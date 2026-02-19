/**
 * Analytics Service
 * Calculates profit/loss, return rates, and performance metrics
 */

import { IStockDataProvider } from "../../data/stock_data_client/stock_data_provider";
import {
  AccountId,
  TransactionType,
  OrderStatus,
} from "../../data/trading_repository/trading_data_models";
import { ITradingDataRepository } from "../../data/trading_repository/trading_data_repository";
import { PerformanceReport, TransactionViewItem } from "./trading_types";

/**
 * Analytics Service
 * Handles performance calculations and metrics
 */
export class AnalyticsService {
  private repository: ITradingDataRepository;
  private stockDataProvider: IStockDataProvider;

  constructor(repository: ITradingDataRepository, stockDataProvider: IStockDataProvider) {
    this.repository = repository;
    this.stockDataProvider = stockDataProvider;
  }

  /**
   * Calculate performance metrics for an account
   */
  async getPerformanceMetrics(accountId: AccountId): Promise<PerformanceReport> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Get all transactions
    const transactions = await this.repository.getTransactions(accountId);

    // Calculate realized P&L from sell transactions
    let realizedPnL = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    // Build cost basis tracking for each stock
    const costBasis: Map<string, { totalCost: number; quantity: number }> = new Map();

    for (const tx of transactions) {
      if (tx.status !== OrderStatus.EXECUTED) continue;

      const stockCode = tx.stockCode.toUpperCase();
      const basis = costBasis.get(stockCode) || {
        totalCost: 0,
        quantity: 0,
      };

      if (tx.type === TransactionType.BUY) {
        // Add to cost basis
        basis.totalCost += tx.totalAmount;
        basis.quantity += tx.quantity;
      } else if (tx.type === TransactionType.SELL) {
        // Calculate realized P&L
        if (basis.quantity > 0) {
          const avgCost = basis.totalCost / basis.quantity;
          const costOfSold = avgCost * tx.quantity;
          const pnl = tx.totalAmount - costOfSold;

          realizedPnL += pnl;

          if (pnl >= 0) {
            winningTrades++;
          } else {
            losingTrades++;
          }

          // Reduce cost basis
          basis.totalCost -= costOfSold;
          basis.quantity -= tx.quantity;
        }
      }

      costBasis.set(stockCode, basis);
    }

    // Get portfolio for unrealized P&L
    const portfolio = await this.repository.loadPortfolio(accountId);
    let unrealizedPnL = 0;

    if (portfolio && portfolio.holdings.length > 0) {
      const stockCodes = portfolio.holdings.map((h) => h.stockCode);
      const quotes = await this.stockDataProvider.getBatchQuotes(stockCodes);

      for (const holding of portfolio.holdings) {
        const quote = quotes.get(holding.stockCode);
        const currentPrice = quote?.price || holding.averageCost;
        const marketValue = currentPrice * holding.quantity;
        unrealizedPnL += marketValue - holding.totalCost;
      }
    }

    const totalPnL = realizedPnL + unrealizedPnL;
    const totalReturnPercent =
      account.initialBalance > 0 ? (totalPnL / account.initialBalance) * 100 : 0;

    const totalTrades = winningTrades + losingTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // Calculate current portfolio value
    let portfolioValue = 0;
    if (portfolio && portfolio.holdings.length > 0) {
      const stockCodes = portfolio.holdings.map((h) => h.stockCode);
      const quotes = await this.stockDataProvider.getBatchQuotes(stockCodes);

      for (const holding of portfolio.holdings) {
        const quote = quotes.get(holding.stockCode);
        const currentPrice = quote?.price || holding.averageCost;
        portfolioValue += currentPrice * holding.quantity;
      }
    }

    return {
      accountId,
      initialBalance: account.initialBalance,
      currentBalance: account.balance,
      portfolioValue,
      totalValue: account.balance + portfolioValue,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      totalReturnPercent,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      generatedAt: new Date(),
    };
  }

  /**
   * Get transaction history view
   */
  async getTransactionHistory(
    accountId: AccountId,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ): Promise<{
    transactions: TransactionViewItem[];
    totalCount: number;
  }> {
    const filter: any = {};
    if (startDate || endDate) {
      filter.startDate = startDate;
      filter.endDate = endDate;
    }

    // Get all transactions to count total
    const allTransactions = await this.repository.getTransactions(accountId, filter);

    // Apply limit if specified
    let transactions = allTransactions;
    if (limit && limit > 0) {
      transactions = allTransactions.slice(0, limit);
    }

    // Get stock names for display
    const stockCodes = [...new Set(transactions.map((tx) => tx.stockCode))];
    const quotes = await this.stockDataProvider.getBatchQuotes(stockCodes);

    const items: TransactionViewItem[] = transactions.map((tx) => ({
      id: tx.id,
      stockCode: tx.stockCode,
      companyName: quotes.get(tx.stockCode)?.companyName,
      type: tx.type,
      quantity: tx.quantity,
      price: tx.price,
      totalAmount: tx.totalAmount,
      status: tx.status,
      timestamp: tx.timestamp,
      notes: tx.notes,
    }));

    return {
      transactions: items,
      totalCount: allTransactions.length,
    };
  }
}
