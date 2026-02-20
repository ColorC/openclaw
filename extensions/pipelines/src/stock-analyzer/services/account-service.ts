/**
 * Stock Analyzer Extension - Account Service
 *
 * Business logic for account management
 */

import type { IStockDataService } from "../data/stock-data-service.js";
import type { IStorageService } from "../data/storage-service.js";
import type {
  Account,
  AccountSettings,
  AccountStatus,
  Position,
  Portfolio,
  PositionSummary,
  CashBreakdown,
  PortfolioMetrics,
} from "../types/index.js";

/**
 * Account creation options
 */
export interface CreateAccountOptions {
  name: string;
  initialCapital: number;
  currency?: string;
  type?: "paper" | "simulation";
}

/**
 * Account service interface
 */
export interface IAccountService {
  createAccount(options: CreateAccountOptions): Promise<Account>;
  getAccount(id: string): Promise<Account | null>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account | null>;
  deleteAccount(id: string): Promise<boolean>;
  listAccounts(): Promise<Account[]>;

  getAccountSettings(accountId: string): Promise<AccountSettings>;
  updateAccountSettings(
    accountId: string,
    settings: Partial<AccountSettings>,
  ): Promise<AccountSettings>;

  getPortfolio(accountId: string): Promise<Portfolio>;
  getPortfolioMetrics(accountId: string): Promise<PortfolioMetrics>;

  deposit(accountId: string, amount: number, description?: string): Promise<Account>;
  withdraw(accountId: string, amount: number, description?: string): Promise<Account>;
}

/**
 * Account service implementation
 */
export class AccountService implements IAccountService {
  private readonly storage: IStorageService;
  private readonly stockDataService: IStockDataService;

  constructor(storage: IStorageService, stockDataService: IStockDataService) {
    this.storage = storage;
    this.stockDataService = stockDataService;
  }

  /**
   * Create a new account
   */
  async createAccount(options: CreateAccountOptions): Promise<Account> {
    const account = this.storage.createAccount({
      name: options.name,
      type: options.type || "paper",
      status: "active",
      cashBalance: options.initialCapital,
      portfolioValue: options.initialCapital,
      initialCapital: options.initialCapital,
      currency: options.currency || "USD",
    });

    // Create default settings
    this.storage.updateAccountSettings(account.id, {
      accountId: account.id,
      marginEnabled: false,
      marginMultiplier: 2,
      shortEnabled: false,
      maxPositionPercent: 20,
      maxDailyLossPercent: 5,
      defaultOrderType: "market",
      currency: options.currency || "USD",
    });

    // Record initial deposit transaction
    this.storage.createTransaction({
      accountId: account.id,
      type: "deposit",
      amount: options.initialCapital,
      balanceAfter: options.initialCapital,
      description: "Initial account funding",
    });

    return account;
  }

  /**
   * Get account by ID
   */
  async getAccount(id: string): Promise<Account | null> {
    return this.storage.getAccount(id);
  }

  /**
   * Update account
   */
  async updateAccount(id: string, updates: Partial<Account>): Promise<Account | null> {
    return this.storage.updateAccount(id, updates);
  }

  /**
   * Delete account
   */
  async deleteAccount(id: string): Promise<boolean> {
    // Delete associated positions
    const positions = this.storage.listPositions(id);
    for (const position of positions) {
      this.storage.deletePosition(position.id);
    }

    // Delete associated trades
    const trades = this.storage.listTrades(id);
    for (const trade of trades) {
      this.storage.updateTrade(trade.id, { status: "cancelled", cancelReason: "Account deleted" });
    }

    return this.storage.deleteAccount(id);
  }

  /**
   * List all accounts
   */
  async listAccounts(): Promise<Account[]> {
    return this.storage.listAccounts();
  }

  /**
   * Get account settings
   */
  async getAccountSettings(accountId: string): Promise<AccountSettings> {
    const settings = this.storage.getAccountSettings(accountId);
    if (settings) return settings;

    // Return default settings
    return {
      accountId,
      marginEnabled: false,
      marginMultiplier: 2,
      shortEnabled: false,
      maxPositionPercent: 20,
      maxDailyLossPercent: 5,
      defaultOrderType: "market",
      currency: "USD",
    };
  }

  /**
   * Update account settings
   */
  async updateAccountSettings(
    accountId: string,
    settings: Partial<AccountSettings>,
  ): Promise<AccountSettings> {
    return this.storage.updateAccountSettings(accountId, settings);
  }

  /**
   * Get full portfolio for an account
   */
  async getPortfolio(accountId: string): Promise<Portfolio> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const positions = await this.getPositionsWithMarketValue(accountId);
    const summary = this.calculatePositionSummary(positions);
    const cash = this.calculateCashBreakdown(account, positions);
    const metrics = await this.calculatePortfolioMetrics(account, positions);

    // Update account portfolio value
    const portfolioValue = cash.total + summary.totalMarketValue;
    if (account.portfolioValue !== portfolioValue) {
      await this.storage.updateAccount(accountId, { portfolioValue });
      account.portfolioValue = portfolioValue;
    }

    return {
      accountId,
      account,
      positions,
      summary,
      cash,
      metrics,
      updatedAt: new Date(),
    };
  }

  /**
   * Get portfolio metrics
   */
  async getPortfolioMetrics(accountId: string): Promise<PortfolioMetrics> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const positions = await this.getPositionsWithMarketValue(accountId);
    return this.calculatePortfolioMetrics(account, positions);
  }

  /**
   * Deposit funds into account
   */
  async deposit(accountId: string, amount: number, description?: string): Promise<Account> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    if (amount <= 0) {
      throw new Error("Deposit amount must be positive");
    }

    const newBalance = account.cashBalance + amount;
    const updated = await this.storage.updateAccount(accountId, {
      cashBalance: newBalance,
      initialCapital: account.initialCapital + amount,
    });

    // Record transaction
    this.storage.createTransaction({
      accountId,
      type: "deposit",
      amount,
      balanceAfter: newBalance,
      description: description || "Cash deposit",
    });

    return updated!;
  }

  /**
   * Withdraw funds from account
   */
  async withdraw(accountId: string, amount: number, description?: string): Promise<Account> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    if (amount <= 0) {
      throw new Error("Withdrawal amount must be positive");
    }

    if (amount > account.cashBalance) {
      throw new Error("Insufficient funds for withdrawal");
    }

    const newBalance = account.cashBalance - amount;
    const updated = await this.storage.updateAccount(accountId, {
      cashBalance: newBalance,
      initialCapital: account.initialCapital - amount,
    });

    // Record transaction
    this.storage.createTransaction({
      accountId,
      type: "withdrawal",
      amount: -amount,
      balanceAfter: newBalance,
      description: description || "Cash withdrawal",
    });

    return updated!;
  }

  /**
   * Get positions with current market values
   */
  private async getPositionsWithMarketValue(accountId: string): Promise<Position[]> {
    const positions = this.storage.listPositions(accountId);
    const symbols = positions.map((p) => p.symbol);

    if (symbols.length === 0) return [];

    const quotes = await this.stockDataService.getQuotes(symbols);

    return positions.map((position) => {
      const quote = quotes.get(position.symbol);
      if (quote) {
        const marketValue = position.quantity * quote.price;
        const unrealizedPL = marketValue - position.costBasis;
        const unrealizedPLPercent = (unrealizedPL / position.costBasis) * 100;

        return {
          ...position,
          marketValue,
          unrealizedPL,
          unrealizedPLPercent,
          updatedAt: new Date(),
        };
      }
      return position;
    });
  }

  /**
   * Calculate position summary
   */
  private calculatePositionSummary(positions: Position[]): PositionSummary {
    const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const totalUnrealizedPL = positions.reduce((sum, p) => sum + p.unrealizedPL, 0);

    // Sort by market value for top holdings
    const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
    const topHoldings = sorted.slice(0, 5);

    // Find best and worst performers
    let bestPerformer: Position | undefined;
    let worstPerformer: Position | undefined;

    for (const position of positions) {
      if (!bestPerformer || position.unrealizedPLPercent > bestPerformer.unrealizedPLPercent) {
        bestPerformer = position;
      }
      if (!worstPerformer || position.unrealizedPLPercent < worstPerformer.unrealizedPLPercent) {
        worstPerformer = position;
      }
    }

    return {
      totalPositions: positions.length,
      totalMarketValue,
      totalCostBasis,
      totalUnrealizedPL,
      topHoldings,
      bestPerformer,
      worstPerformer,
    };
  }

  /**
   * Calculate cash breakdown
   */
  private calculateCashBreakdown(account: Account, positions: Position[]): CashBreakdown {
    // Calculate reserved cash for pending orders
    const pendingTrades = this.storage
      .listTrades(account.id)
      .filter((t) => t.status === "pending" || t.status === "open");

    const reserved = pendingTrades.reduce((sum, trade) => {
      if (trade.side === "buy") {
        const price = trade.limitPrice || 0;
        return sum + price * trade.quantity;
      }
      return sum;
    }, 0);

    return {
      available: Math.max(0, account.cashBalance - reserved),
      reserved,
      total: account.cashBalance,
    };
  }

  /**
   * Calculate portfolio metrics
   */
  private async calculatePortfolioMetrics(
    account: Account,
    positions: Position[],
  ): Promise<PortfolioMetrics> {
    const totalReturn = account.portfolioValue - account.initialCapital;
    const totalReturnPercent = (totalReturn / account.initialCapital) * 100;

    // Calculate winners/losers
    const winners = positions.filter((p) => p.unrealizedPL > 0).length;
    const losers = positions.filter((p) => p.unrealizedPL < 0).length;
    const winRate = positions.length > 0 ? (winners / positions.length) * 100 : 0;

    // Calculate diversification score (based on position count and distribution)
    const diversificationScore = this.calculateDiversificationScore(positions);

    return {
      totalReturn,
      totalReturnPercent,
      dailyReturnPercent: 0, // Would need historical data
      winners,
      losers,
      winRate,
      maxDrawdown: 0, // Would need historical data
      diversificationScore,
    };
  }

  /**
   * Calculate diversification score
   */
  private calculateDiversificationScore(positions: Position[]): number {
    if (positions.length === 0) return 0;
    if (positions.length === 1) return 10;

    const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    if (totalValue === 0) return 0;

    // Calculate Herfindahl-Hirschman Index for concentration
    const hhi = positions.reduce((sum, p) => {
      const share = (p.marketValue / totalValue) * 100;
      return sum + share * share;
    }, 0);

    // Convert HHI to diversification score (0-100)
    // Lower HHI = more diversified = higher score
    const maxHHI = 10000; // Single position
    const minHHI = 10000 / positions.length; // Equal distribution
    const normalized = (maxHHI - hhi) / (maxHHI - minHHI);

    return Math.round(normalized * 100);
  }
}
