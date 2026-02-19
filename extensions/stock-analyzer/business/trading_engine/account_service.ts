/**
 * Account Service
 * Manages account creation, balance operations, and fund allocation
 */

import {
  AccountId,
  AccountData,
  AccountStatus,
  AccountConfig,
} from "../../data/trading_repository/trading_data_models";
import { ITradingDataRepository } from "../../data/trading_repository/trading_data_repository";
import { AccountInfo } from "./trading_types";

/**
 * Account Service
 * Handles account-related business logic
 */
export class AccountService {
  private repository: ITradingDataRepository;

  constructor(repository: ITradingDataRepository) {
    this.repository = repository;
  }

  /**
   * Create a new simulated trading account
   */
  async createAccount(config: AccountConfig): Promise<AccountInfo> {
    const now = new Date();

    const accountData: AccountData = {
      id: "", // Will be set by repository
      name: config.name,
      initialBalance: config.initialBalance,
      balance: config.initialBalance,
      portfolioValue: 0,
      status: AccountStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      metadata: config.metadata,
    };

    const accountId = await this.repository.saveAccount(accountData);

    // Load the saved account to get the generated ID
    const saved = await this.repository.loadAccount(accountId);
    if (!saved) {
      throw new Error("Failed to create account");
    }

    // Initialize empty portfolio
    await this.repository.savePortfolio(accountId, {
      accountId,
      holdings: [],
      updatedAt: now,
    });

    return this.toAccountInfo(saved);
  }

  /**
   * Get account information
   */
  async getAccountInfo(accountId: AccountId): Promise<AccountInfo | null> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      return null;
    }

    return this.toAccountInfo(account);
  }

  /**
   * Update account balance
   */
  async updateBalance(accountId: AccountId, amount: number): Promise<AccountInfo> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const newBalance = account.balance + amount;
    if (newBalance < 0) {
      throw new Error("Insufficient balance");
    }

    const updated: AccountData = {
      ...account,
      balance: newBalance,
      updatedAt: new Date(),
    };

    await this.repository.saveAccount(updated);
    return this.toAccountInfo(updated);
  }

  /**
   * Update portfolio value
   */
  async updatePortfolioValue(accountId: AccountId, portfolioValue: number): Promise<void> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const updated: AccountData = {
      ...account,
      portfolioValue,
      updatedAt: new Date(),
    };

    await this.repository.saveAccount(updated);
  }

  /**
   * Check if account has sufficient balance
   */
  async hasSufficientBalance(accountId: AccountId, amount: number): Promise<boolean> {
    const account = await this.repository.loadAccount(accountId);
    if (!account) {
      return false;
    }

    return account.balance >= amount;
  }

  /**
   * Get all accounts
   */
  async getAllAccounts(): Promise<AccountInfo[]> {
    const repository = this.repository as any;
    if (typeof repository.getAllAccounts === "function") {
      const accounts = await repository.getAllAccounts();
      return accounts.map((a: AccountData) => this.toAccountInfo(a));
    }
    return [];
  }

  /**
   * Delete account
   */
  async deleteAccount(accountId: AccountId): Promise<boolean> {
    return this.repository.deleteAccount(accountId);
  }

  /**
   * Convert AccountData to AccountInfo
   */
  private toAccountInfo(account: AccountData): AccountInfo {
    return {
      id: account.id,
      name: account.name,
      initialBalance: account.initialBalance,
      balance: account.balance,
      portfolioValue: account.portfolioValue,
      totalValue: account.balance + account.portfolioValue,
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
