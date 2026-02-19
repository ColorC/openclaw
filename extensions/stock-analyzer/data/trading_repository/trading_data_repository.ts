/**
 * Trading Data Repository Interface
 * Interface for persisting trading data (accounts, portfolios, transactions)
 */

import {
  AccountId,
  TransactionId,
  AccountData,
  PortfolioData,
  TransactionRecord,
  QueryFilter,
} from "./trading_data_models";

/**
 * Interface for trading data repository
 * Implements repository pattern for data persistence
 */
export interface ITradingDataRepository {
  // Account operations
  /**
   * Persist simulated account
   * @param accountData Account data to save
   * @returns Promise resolving to account ID
   */
  saveAccount(accountData: AccountData): Promise<AccountId>;

  /**
   * Load account data
   * @param accountId Account ID to load
   * @returns Promise resolving to account data or null if not found
   */
  loadAccount(accountId: AccountId): Promise<AccountData | null>;

  /**
   * Delete account and all associated data
   * @param accountId Account ID to delete
   * @returns Promise resolving to true if deleted successfully
   */
  deleteAccount(accountId: AccountId): Promise<boolean>;

  // Portfolio operations
  /**
   * Save portfolio holdings for an account
   * @param accountId Account ID
   * @param portfolioData Portfolio data to save
   * @returns Promise resolving to success status
   */
  savePortfolio(accountId: AccountId, portfolioData: PortfolioData): Promise<boolean>;

  /**
   * Load portfolio holdings for an account
   * @param accountId Account ID
   * @returns Promise resolving to portfolio data or null if not found
   */
  loadPortfolio(accountId: AccountId): Promise<PortfolioData | null>;

  // Transaction operations
  /**
   * Save a transaction record
   * @param transaction Transaction record to save
   * @returns Promise resolving to transaction ID
   */
  saveTransaction(transaction: TransactionRecord): Promise<TransactionId>;

  /**
   * Query transactions with filters
   * @param accountId Account ID
   * @param filter Query filters
   * @returns Promise resolving to list of transactions
   */
  getTransactions(accountId: AccountId, filter?: QueryFilter): Promise<TransactionRecord[]>;
}
