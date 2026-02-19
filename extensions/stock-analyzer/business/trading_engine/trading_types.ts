/**
 * Trading Types
 * Business layer type definitions for trading operations
 */

import { StockQuote } from "../../data/stock_data_client/stock_data_types";
import {
  AccountId,
  StockCode,
  AccountStatus,
  TransactionType,
  OrderStatus,
} from "../../data/trading_repository/trading_data_models";

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

/**
 * Account information for display
 */
export interface AccountInfo {
  /** Account ID */
  id: AccountId;
  /** Account name */
  name: string;
  /** Initial balance */
  initialBalance: number;
  /** Current available balance */
  balance: number;
  /** Total portfolio value */
  portfolioValue: number;
  /** Total account value (balance + portfolio) */
  totalValue: number;
  /** Account status */
  status: AccountStatus;
  /** Creation date */
  createdAt: Date;
  /** Last update date */
  updatedAt: Date;
}

/**
 * Buy order request
 */
export interface BuyOrderRequest {
  /** Account ID */
  accountId: AccountId;
  /** Stock code to buy */
  stockCode: StockCode;
  /** Number of shares to buy */
  quantity: number;
  /** Maximum price per share (optional) */
  maxPrice?: number;
  /** Order notes */
  notes?: string;
}

/**
 * Sell order request
 */
export interface SellOrderRequest {
  /** Account ID */
  accountId: AccountId;
  /** Stock code to sell */
  stockCode: StockCode;
  /** Number of shares to sell */
  quantity: number;
  /** Minimum price per share (optional) */
  minPrice?: number;
  /** Order notes */
  notes?: string;
}

/**
 * Order execution result
 */
export interface OrderResult {
  /** Whether order was successful */
  success: boolean;
  /** Transaction ID if successful */
  transactionId?: string;
  /** Error message if failed */
  error?: string;
  /** Stock code */
  stockCode: StockCode;
  /** Order type */
  orderType: TransactionType;
  /** Number of shares */
  quantity: number;
  /** Execution price per share */
  executionPrice: number;
  /** Total amount */
  totalAmount: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Portfolio holding view with current value
 */
export interface PortfolioHoldingView {
  /** Stock code */
  stockCode: StockCode;
  /** Company name */
  companyName?: string;
  /** Number of shares held */
  quantity: number;
  /** Average cost per share */
  averageCost: number;
  /** Total cost basis */
  totalCost: number;
  /** Current market price */
  currentPrice: number;
  /** Current market value */
  marketValue: number;
  /** Unrealized profit/loss */
  unrealizedPnL: number;
  /** Unrealized profit/loss percentage */
  unrealizedPnLPercent: number;
}

/**
 * Portfolio view for display
 */
export interface PortfolioView {
  /** Account ID */
  accountId: AccountId;
  /** List of holdings */
  holdings: PortfolioHoldingView[];
  /** Total cost basis */
  totalCost: number;
  /** Total market value */
  totalMarketValue: number;
  /** Total unrealized profit/loss */
  totalUnrealizedPnL: number;
  /** Total unrealized profit/loss percentage */
  totalUnrealizedPnLPercent: number;
  /** Available balance */
  availableBalance: number;
  /** Total portfolio value */
  totalValue: number;
}

/**
 * Date range filter
 */
export interface DateRange {
  /** Start date */
  start?: Date;
  /** End date */
  end?: Date;
}

/**
 * Transaction history view
 */
export interface TransactionHistoryView {
  /** Account ID */
  accountId: AccountId;
  /** List of transactions */
  transactions: TransactionViewItem[];
  /** Total count (before pagination) */
  totalCount: number;
}

/**
 * Transaction view item for display
 */
export interface TransactionViewItem {
  /** Transaction ID */
  id: string;
  /** Stock code */
  stockCode: StockCode;
  /** Company name */
  companyName?: string;
  /** Transaction type */
  type: TransactionType;
  /** Number of shares */
  quantity: number;
  /** Price per share */
  price: number;
  /** Total amount */
  totalAmount: number;
  /** Order status */
  status: OrderStatus;
  /** Timestamp */
  timestamp: Date;
  /** Notes */
  notes?: string;
}

/**
 * Performance report
 */
export interface PerformanceReport {
  /** Account ID */
  accountId: AccountId;
  /** Initial balance */
  initialBalance: number;
  /** Current balance */
  currentBalance: number;
  /** Portfolio value */
  portfolioValue: number;
  /** Total account value */
  totalValue: number;
  /** Realized profit/loss */
  realizedPnL: number;
  /** Unrealized profit/loss */
  unrealizedPnL: number;
  /** Total profit/loss */
  totalPnL: number;
  /** Total return percentage */
  totalReturnPercent: number;
  /** Number of trades */
  totalTrades: number;
  /** Number of winning trades */
  winningTrades: number;
  /** Number of losing trades */
  losingTrades: number;
  /** Win rate percentage */
  winRate: number;
  /** Report generated timestamp */
  generatedAt: Date;
}

/**
 * Stock search result
 */
export interface StockSearchResult {
  /** Stock symbol */
  symbol: string;
  /** Company name */
  name: string;
  /** Exchange */
  exchange: string;
  /** Current price */
  price: number;
  /** Price change */
  change: number;
  /** Price change percentage */
  changePercent: number;
}

/**
 * Stock quote view for display
 */
export interface StockQuoteView {
  /** Stock symbol */
  symbol: string;
  /** Company name */
  companyName?: string;
  /** Current price */
  price: number;
  /** Price change */
  change: number;
  /** Price change percentage */
  changePercent: number;
  /** Trading volume */
  volume: number;
  /** Previous close price */
  previousClose: number;
  /** Day's high */
  high: number;
  /** Day's low */
  low: number;
  /** Day's open */
  open: number;
  /** Quote timestamp */
  timestamp: Date;
}
