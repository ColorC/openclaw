/**
 * Trading Repository
 * Implementation of ITradingDataRepository with in-memory storage
 */

import {
  AccountId,
  TransactionId,
  AccountData,
  PortfolioData,
  TransactionRecord,
  QueryFilter,
  AccountStatus,
  TransactionType,
  OrderStatus,
} from "./trading_data_models";
import { ITradingDataRepository } from "./trading_data_repository";

/**
 * Trading Repository
 * Manages persistence for accounts, portfolios, and transactions
 */
export class TradingRepository implements ITradingDataRepository {
  private accounts: Map<AccountId, AccountData>;
  private portfolios: Map<AccountId, PortfolioData>;
  private transactions: Map<TransactionId, TransactionRecord>;
  private accountTransactions: Map<AccountId, TransactionId[]>;

  constructor() {
    this.accounts = new Map();
    this.portfolios = new Map();
    this.transactions = new Map();
    this.accountTransactions = new Map();
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Persist simulated account
   */
  async saveAccount(accountData: AccountData): Promise<AccountId> {
    const id = accountData.id || this.generateId();
    const account: AccountData = {
      ...accountData,
      id,
      updatedAt: new Date(),
    };

    this.accounts.set(id, account);
    return id;
  }

  /**
   * Load account data
   */
  async loadAccount(accountId: AccountId): Promise<AccountData | null> {
    return this.accounts.get(accountId) || null;
  }

  /**
   * Delete account and all associated data
   */
  async deleteAccount(accountId: AccountId): Promise<boolean> {
    if (!this.accounts.has(accountId)) {
      return false;
    }

    // Delete account
    this.accounts.delete(accountId);

    // Delete portfolio
    this.portfolios.delete(accountId);

    // Delete transactions
    const transactionIds = this.accountTransactions.get(accountId) || [];
    for (const txId of transactionIds) {
      this.transactions.delete(txId);
    }
    this.accountTransactions.delete(accountId);

    return true;
  }

  /**
   * Save portfolio holdings for an account
   */
  async savePortfolio(accountId: AccountId, portfolioData: PortfolioData): Promise<boolean> {
    if (!this.accounts.has(accountId)) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const portfolio: PortfolioData = {
      ...portfolioData,
      accountId,
      updatedAt: new Date(),
    };

    this.portfolios.set(accountId, portfolio);
    return true;
  }

  /**
   * Load portfolio holdings for an account
   */
  async loadPortfolio(accountId: AccountId): Promise<PortfolioData | null> {
    if (!this.accounts.has(accountId)) {
      return null;
    }

    // Return empty portfolio if not exists
    const existing = this.portfolios.get(accountId);
    if (existing) {
      return existing;
    }

    // Return default empty portfolio
    return {
      accountId,
      holdings: [],
      updatedAt: new Date(),
    };
  }

  /**
   * Save a transaction record
   */
  async saveTransaction(transaction: TransactionRecord): Promise<TransactionId> {
    const id = transaction.id || this.generateId();
    const tx: TransactionRecord = {
      ...transaction,
      id,
    };

    this.transactions.set(id, tx);

    // Track transaction by account
    const accountTxIds = this.accountTransactions.get(transaction.accountId) || [];
    accountTxIds.push(id);
    this.accountTransactions.set(transaction.accountId, accountTxIds);

    return id;
  }

  /**
   * Query transactions with filters
   */
  async getTransactions(accountId: AccountId, filter?: QueryFilter): Promise<TransactionRecord[]> {
    const txIds = this.accountTransactions.get(accountId) || [];
    let results: TransactionRecord[] = [];

    // Fetch all transactions for account
    for (const txId of txIds) {
      const tx = this.transactions.get(txId);
      if (tx) {
        results.push(tx);
      }
    }

    // Apply filters
    if (filter) {
      if (filter.startDate) {
        results = results.filter((tx) => tx.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        results = results.filter((tx) => tx.timestamp <= filter.endDate!);
      }
      if (filter.type) {
        results = results.filter((tx) => tx.type === filter.type);
      }
      if (filter.stockCode) {
        results = results.filter((tx) => tx.stockCode === filter.stockCode);
      }
      if (filter.status) {
        results = results.filter((tx) => tx.status === filter.status);
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    if (filter?.offset) {
      results = results.slice(filter.offset);
    }
    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get all accounts (utility method)
   */
  async getAllAccounts(): Promise<AccountData[]> {
    return Array.from(this.accounts.values());
  }

  /**
   * Check if account exists
   */
  async accountExists(accountId: AccountId): Promise<boolean> {
    return this.accounts.has(accountId);
  }
}
