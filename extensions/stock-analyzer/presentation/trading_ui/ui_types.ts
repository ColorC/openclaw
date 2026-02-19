/**
 * UI Types
 * Type definitions for UI components and view models
 */

import {
  AccountInfo,
  OrderResult,
  PortfolioView,
  PerformanceReport,
  StockQuoteView,
  TransactionViewItem,
} from "../../business/trading_engine/trading_types";

/**
 * Account form state
 */
export interface AccountFormState {
  name: string;
  initialBalance: string;
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Order form state
 */
export interface OrderFormState {
  stockCode: string;
  quantity: string;
  price?: string;
  notes?: string;
  isValid: boolean;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

/**
 * Stock search state
 */
export interface StockSearchState {
  query: string;
  isSearching: boolean;
  results: StockSearchResult[];
  error?: string;
}

/**
 * Stock search result
 */
export interface StockSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
}

/**
 * Account view model
 */
export interface AccountViewModel {
  id: string;
  name: string;
  balance: number;
  portfolioValue: number;
  totalValue: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Portfolio view model
 */
export interface PortfolioViewModel {
  holdings: HoldingViewModel[];
  totalCost: number;
  totalMarketValue: number;
  totalUnrealizedPnL: number;
  totalUnrealizedPnLPercent: number;
  availableBalance: number;
  totalValue: number;
}

/**
 * Holding view model
 */
export interface HoldingViewModel {
  stockCode: string;
  companyName?: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  pnlClass: "positive" | "negative" | "neutral";
}

/**
 * Transaction view model
 */
export interface TransactionViewModel {
  id: string;
  stockCode: string;
  companyName?: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  totalAmount: number;
  status: string;
  timestamp: string;
  notes?: string;
  typeClass: "buy" | "sell";
}

/**
 * Performance view model
 */
export interface PerformanceViewModel {
  initialBalance: number;
  currentBalance: number;
  portfolioValue: number;
  totalValue: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  pnlClass: "positive" | "negative" | "neutral";
}

/**
 * Quote view model
 */
export interface QuoteViewModel {
  symbol: string;
  companyName?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  high: number;
  low: number;
  open: number;
  timestamp: string;
  changeClass: "positive" | "negative" | "neutral";
}

/**
 * UI notification
 */
export interface UINotification {
  type: "success" | "error" | "warning" | "info";
  message: string;
  timestamp: Date;
}

/**
 * Formatters for display
 */
export const formatters = {
  currency: (value: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  },

  number: (value: number, decimals: number = 2): string => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  },

  percent: (value: number): string => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  },

  date: (date: Date): string => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  },

  datetime: (date: Date): string => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  },

  volume: (value: number): string => {
    if (value >= 1e9) {
      return `${(value / 1e9).toFixed(2)}B`;
    } else if (value >= 1e6) {
      return `${(value / 1e6).toFixed(2)}M`;
    } else if (value >= 1e3) {
      return `${(value / 1e3).toFixed(2)}K`;
    }
    return value.toString();
  },
};

/**
 * Converters from business types to view models
 */
export const converters = {
  toAccountViewModel: (account: AccountInfo): AccountViewModel => ({
    id: account.id,
    name: account.name,
    balance: account.balance,
    portfolioValue: account.portfolioValue,
    totalValue: account.totalValue,
    status: account.status,
    createdAt: formatters.datetime(account.createdAt),
    updatedAt: formatters.datetime(account.updatedAt),
  }),

  toHoldingViewModel: (holding: any): HoldingViewModel => {
    const pnlClass =
      holding.unrealizedPnL > 0 ? "positive" : holding.unrealizedPnL < 0 ? "negative" : "neutral";
    return {
      ...holding,
      pnlClass,
    };
  },

  toPortfolioViewModel: (portfolio: PortfolioView): PortfolioViewModel => ({
    holdings: portfolio.holdings.map(converters.toHoldingViewModel),
    totalCost: portfolio.totalCost,
    totalMarketValue: portfolio.totalMarketValue,
    totalUnrealizedPnL: portfolio.totalUnrealizedPnL,
    totalUnrealizedPnLPercent: portfolio.totalUnrealizedPnLPercent,
    availableBalance: portfolio.availableBalance,
    totalValue: portfolio.totalValue,
  }),

  toTransactionViewModel: (tx: TransactionViewItem): TransactionViewModel => ({
    id: tx.id,
    stockCode: tx.stockCode,
    companyName: tx.companyName,
    type: tx.type,
    quantity: tx.quantity,
    price: tx.price,
    totalAmount: tx.totalAmount,
    status: tx.status,
    timestamp: formatters.datetime(tx.timestamp),
    notes: tx.notes,
    typeClass: tx.type === "BUY" ? "buy" : "sell",
  }),

  toPerformanceViewModel: (report: PerformanceReport): PerformanceViewModel => {
    const pnlClass =
      report.totalPnL > 0 ? "positive" : report.totalPnL < 0 ? "negative" : "neutral";
    return {
      initialBalance: report.initialBalance,
      currentBalance: report.currentBalance,
      portfolioValue: report.portfolioValue,
      totalValue: report.totalValue,
      realizedPnL: report.realizedPnL,
      unrealizedPnL: report.unrealizedPnL,
      totalPnL: report.totalPnL,
      totalReturnPercent: report.totalReturnPercent,
      totalTrades: report.totalTrades,
      winningTrades: report.winningTrades,
      losingTrades: report.losingTrades,
      winRate: report.winRate,
      pnlClass,
    };
  },

  toQuoteViewModel: (quote: StockQuoteView): QuoteViewModel => {
    const changeClass = quote.change > 0 ? "positive" : quote.change < 0 ? "negative" : "neutral";
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
      timestamp: formatters.datetime(quote.timestamp),
      changeClass,
    };
  },
};
