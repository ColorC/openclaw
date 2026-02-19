/**
 * Trading Data Models
 * Entity definitions for accounts, portfolios, and transactions
 */

/**
 * Account identifier
 */
export type AccountId = string;

/**
 * Transaction identifier
 */
export type TransactionId = string;

/**
 * Stock code type
 */
export type StockCode = string;

/**
 * Account status
 */
export enum AccountStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  CLOSED = "CLOSED",
}

/**
 * Transaction type
 */
export enum TransactionType {
  BUY = "BUY",
  SELL = "SELL",
}

/**
 * Order status
 */
export enum OrderStatus {
  PENDING = "PENDING",
  EXECUTED = "EXECUTED",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
}

/**
 * Account data entity
 */
export interface AccountData {
  /** Unique account identifier */
  id: AccountId;
  /** Account name */
  name: string;
  /** Initial balance */
  initialBalance: number;
  /** Current available balance */
  balance: number;
  /** Total portfolio value */
  portfolioValue: number;
  /** Account status */
  status: AccountStatus;
  /** Account creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Account metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Portfolio holding for a single stock
 */
export interface PortfolioHolding {
  /** Stock code */
  stockCode: StockCode;
  /** Number of shares held */
  quantity: number;
  /** Average cost per share */
  averageCost: number;
  /** Total cost basis */
  totalCost: number;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Portfolio data entity
 */
export interface PortfolioData {
  /** Account ID this portfolio belongs to */
  accountId: AccountId;
  /** List of holdings */
  holdings: PortfolioHolding[];
  /** Portfolio last updated timestamp */
  updatedAt: Date;
}

/**
 * Transaction record entity
 */
export interface TransactionRecord {
  /** Unique transaction identifier */
  id: TransactionId;
  /** Account ID */
  accountId: AccountId;
  /** Stock code */
  stockCode: StockCode;
  /** Transaction type (buy/sell) */
  type: TransactionType;
  /** Number of shares */
  quantity: number;
  /** Price per share */
  price: number;
  /** Total transaction amount */
  totalAmount: number;
  /** Order status */
  status: OrderStatus;
  /** Transaction timestamp */
  timestamp: Date;
  /** Additional notes */
  notes?: string;
}

/**
 * Query filter for transactions
 */
export interface QueryFilter {
  /** Start date filter */
  startDate?: Date;
  /** End date filter */
  endDate?: Date;
  /** Transaction type filter */
  type?: TransactionType;
  /** Stock code filter */
  stockCode?: StockCode;
  /** Status filter */
  status?: OrderStatus;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Account configuration for creation
 */
export interface AccountConfig {
  /** Account name */
  name: string;
  /** Initial balance */
  initialBalance: number;
  /** Account metadata */
  metadata?: Record<string, unknown>;
}
