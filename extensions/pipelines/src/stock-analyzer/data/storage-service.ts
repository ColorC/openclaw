/**
 * Stock Analyzer Extension - Storage Service
 *
 * Persistence layer for account data, positions, and transactions
 * Supports in-memory and file-based storage
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Account,
  AccountSettings,
  Position,
  Trade,
  Transaction,
  TransactionFilter,
  StorageConfig,
} from "../types/index.js";

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Storage data structure
 */
interface StorageData {
  accounts: Map<string, Account>;
  settings: Map<string, AccountSettings>;
  positions: Map<string, Position>;
  trades: Map<string, Trade>;
  transactions: Transaction[];
  version: string;
  lastSaved: Date;
}

/**
 * Storage service interface
 */
export interface IStorageService {
  // Account operations
  createAccount(account: Omit<Account, "id" | "createdAt" | "updatedAt">): Account;
  getAccount(id: string): Account | null;
  updateAccount(id: string, updates: Partial<Account>): Account | null;
  deleteAccount(id: string): boolean;
  listAccounts(): Account[];

  // Settings operations
  getAccountSettings(accountId: string): AccountSettings | null;
  updateAccountSettings(accountId: string, settings: Partial<AccountSettings>): AccountSettings;

  // Position operations
  createPosition(position: Omit<Position, "id" | "openedAt" | "updatedAt">): Position;
  getPosition(id: string): Position | null;
  getPositionBySymbol(accountId: string, symbol: string): Position | null;
  updatePosition(id: string, updates: Partial<Position>): Position | null;
  deletePosition(id: string): boolean;
  listPositions(accountId: string): Position[];

  // Trade operations
  createTrade(trade: Omit<Trade, "id" | "createdAt">): Trade;
  getTrade(id: string): Trade | null;
  updateTrade(id: string, updates: Partial<Trade>): Trade | null;
  listTrades(accountId: string): Trade[];

  // Transaction operations
  createTransaction(transaction: Omit<Transaction, "id" | "timestamp">): Transaction;
  getTransaction(id: string): Transaction | null;
  listTransactions(filter: TransactionFilter): Transaction[];

  // Persistence
  save(): Promise<void>;
  load(): Promise<void>;
}

/**
 * In-memory storage implementation
 */
export class MemoryStorage implements IStorageService {
  protected data: StorageData;

  constructor() {
    this.data = {
      accounts: new Map(),
      settings: new Map(),
      positions: new Map(),
      trades: new Map(),
      transactions: [],
      version: "1.0.0",
      lastSaved: new Date(),
    };
  }

  // Account operations
  createAccount(accountData: Omit<Account, "id" | "createdAt" | "updatedAt">): Account {
    const account: Account = {
      ...accountData,
      id: generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.data.accounts.set(account.id, account);
    return account;
  }

  getAccount(id: string): Account | null {
    return this.data.accounts.get(id) || null;
  }

  updateAccount(id: string, updates: Partial<Account>): Account | null {
    const account = this.data.accounts.get(id);
    if (!account) return null;

    const updated: Account = {
      ...account,
      ...updates,
      id: account.id,
      createdAt: account.createdAt,
      updatedAt: new Date(),
    };
    this.data.accounts.set(id, updated);
    return updated;
  }

  deleteAccount(id: string): boolean {
    return this.data.accounts.delete(id);
  }

  listAccounts(): Account[] {
    return Array.from(this.data.accounts.values());
  }

  // Settings operations
  getAccountSettings(accountId: string): AccountSettings | null {
    return this.data.settings.get(accountId) || null;
  }

  updateAccountSettings(accountId: string, settings: Partial<AccountSettings>): AccountSettings {
    const existing = this.data.settings.get(accountId) || {
      accountId,
      marginEnabled: false,
      marginMultiplier: 2,
      shortEnabled: false,
      maxPositionPercent: 20,
      maxDailyLossPercent: 5,
      defaultOrderType: "market" as const,
      currency: "USD",
    };

    const updated: AccountSettings = {
      ...existing,
      ...settings,
      accountId,
    };
    this.data.settings.set(accountId, updated);
    return updated;
  }

  // Position operations
  createPosition(positionData: Omit<Position, "id" | "openedAt" | "updatedAt">): Position {
    const position: Position = {
      ...positionData,
      id: generateId(),
      openedAt: new Date(),
      updatedAt: new Date(),
    };
    this.data.positions.set(position.id, position);
    return position;
  }

  getPosition(id: string): Position | null {
    return this.data.positions.get(id) || null;
  }

  getPositionBySymbol(accountId: string, symbol: string): Position | null {
    for (const position of this.data.positions.values()) {
      if (position.accountId === accountId && position.symbol === symbol) {
        return position;
      }
    }
    return null;
  }

  updatePosition(id: string, updates: Partial<Position>): Position | null {
    const position = this.data.positions.get(id);
    if (!position) return null;

    const updated: Position = {
      ...position,
      ...updates,
      id: position.id,
      accountId: position.accountId,
      symbol: position.symbol,
      openedAt: position.openedAt,
      updatedAt: new Date(),
    };
    this.data.positions.set(id, updated);
    return updated;
  }

  deletePosition(id: string): boolean {
    return this.data.positions.delete(id);
  }

  listPositions(accountId: string): Position[] {
    return Array.from(this.data.positions.values()).filter((p) => p.accountId === accountId);
  }

  // Trade operations
  createTrade(tradeData: Omit<Trade, "id" | "createdAt">): Trade {
    const trade: Trade = {
      ...tradeData,
      id: generateId(),
      createdAt: new Date(),
    };
    this.data.trades.set(trade.id, trade);
    return trade;
  }

  getTrade(id: string): Trade | null {
    return this.data.trades.get(id) || null;
  }

  updateTrade(id: string, updates: Partial<Trade>): Trade | null {
    const trade = this.data.trades.get(id);
    if (!trade) return null;

    const updated: Trade = {
      ...trade,
      ...updates,
      id: trade.id,
      createdAt: trade.createdAt,
    };
    this.data.trades.set(id, updated);
    return updated;
  }

  listTrades(accountId: string): Trade[] {
    return Array.from(this.data.trades.values())
      .filter((t) => t.accountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Transaction operations
  createTransaction(transactionData: Omit<Transaction, "id" | "timestamp">): Transaction {
    const transaction: Transaction = {
      ...transactionData,
      id: generateId(),
      timestamp: new Date(),
    };
    this.data.transactions.push(transaction);
    return transaction;
  }

  getTransaction(id: string): Transaction | null {
    return this.data.transactions.find((t) => t.id === id) || null;
  }

  listTransactions(filter: TransactionFilter): Transaction[] {
    let transactions = this.data.transactions.filter((t) => t.accountId === filter.accountId);

    if (filter.type) {
      transactions = transactions.filter((t) => t.type === filter.type);
    }
    if (filter.symbol) {
      transactions = transactions.filter((t) => t.symbol === filter.symbol);
    }
    if (filter.tradeId) {
      transactions = transactions.filter((t) => t.tradeId === filter.tradeId);
    }
    if (filter.startDate) {
      transactions = transactions.filter((t) => t.timestamp >= filter.startDate!);
    }
    if (filter.endDate) {
      transactions = transactions.filter((t) => t.timestamp <= filter.endDate!);
    }
    if (filter.minAmount !== undefined) {
      transactions = transactions.filter((t) => t.amount >= filter.minAmount!);
    }
    if (filter.maxAmount !== undefined) {
      transactions = transactions.filter((t) => t.amount <= filter.maxAmount!);
    }

    // Sort by timestamp descending
    transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Pagination
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 50;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return transactions.slice(start, end);
  }

  // Persistence (no-op for memory storage)
  async save(): Promise<void> {
    // No-op for in-memory storage
  }

  async load(): Promise<void> {
    // No-op for in-memory storage
  }
}

/**
 * File-based storage implementation
 */
export class FileStorage extends MemoryStorage {
  private readonly filePath: string;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private readonly autoSaveInterval: number;

  constructor(config: StorageConfig) {
    super();
    this.filePath = config.path || "./data/stock-analyzer.json";
    this.autoSaveInterval = config.autoSaveInterval || 60000;

    if (config.autoSave) {
      this.startAutoSave();
    }
  }

  /**
   * Save data to file
   */
  async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const dataToSave = {
      version: this.data.version,
      lastSaved: new Date().toISOString(),
      accounts: Array.from(this.data.accounts.entries()),
      settings: Array.from(this.data.settings.entries()),
      positions: Array.from(this.data.positions.entries()),
      trades: Array.from(this.data.trades.entries()),
      transactions: this.data.transactions.map((t) => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
      })),
    };

    await fs.promises.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2), "utf-8");
  }

  /**
   * Load data from file
   */
  async load(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = await fs.promises.readFile(this.filePath, "utf-8");
      const loaded = JSON.parse(content);

      this.data.version = loaded.version || "1.0.0";
      this.data.lastSaved = new Date(loaded.lastSaved);

      this.data.accounts = new Map(
        (loaded.accounts || []).map(([id, account]: [string, unknown]) => [
          id,
          {
            ...account,
            createdAt: new Date((account as Account).createdAt),
            updatedAt: new Date((account as Account).updatedAt),
          },
        ]),
      );

      this.data.settings = new Map(loaded.settings || []);
      this.data.positions = new Map(
        (loaded.positions || []).map(([id, position]: [string, unknown]) => [
          id,
          {
            ...position,
            openedAt: new Date((position as Position).openedAt),
            updatedAt: new Date((position as Position).updatedAt),
          },
        ]),
      );

      this.data.trades = new Map(
        (loaded.trades || []).map(([id, trade]: [string, unknown]) => [
          id,
          {
            ...trade,
            createdAt: new Date((trade as Trade).createdAt),
            executedAt: (trade as Trade).executedAt
              ? new Date((trade as Trade).executedAt!)
              : undefined,
            expiresAt: (trade as Trade).expiresAt
              ? new Date((trade as Trade).expiresAt!)
              : undefined,
          },
        ]),
      );

      this.data.transactions = (loaded.transactions || []).map((t: Transaction) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      }));
    } catch (error) {
      console.error("Failed to load storage:", error);
    }
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.autoSaveTimer = setInterval(() => {
      this.save().catch((err) => console.error("Auto-save failed:", err));
    }, this.autoSaveInterval);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
}

/**
 * Create storage service based on config
 */
export function createStorageService(config: StorageConfig): IStorageService {
  switch (config.type) {
    case "file":
      return new FileStorage(config);
    case "memory":
    default:
      return new MemoryStorage();
  }
}
