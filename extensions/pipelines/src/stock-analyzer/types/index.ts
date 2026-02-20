/**
 * Stock Analyzer Extension - Type Definitions
 *
 * Core domain types for stock trading simulation
 */

// ============================================================================
// Stock Types
// ============================================================================

/**
 * Stock symbol and basic information
 */
export interface Stock {
  /** Stock symbol (e.g., "AAPL", "GOOGL") */
  symbol: string;
  /** Company name */
  name: string;
  /** Stock exchange (e.g., "NASDAQ", "NYSE") */
  exchange: string;
  /** Currency code (e.g., "USD") */
  currency: string;
  /** Stock type */
  type: StockType;
  /** Whether the stock is actively traded */
  isActive: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

export type StockType = "common" | "preferred" | "etf" | "index" | "adr";

/**
 * Real-time stock quote
 */
export interface StockQuote {
  /** Stock symbol */
  symbol: string;
  /** Current price */
  price: number;
  /** Price change from previous close */
  change: number;
  /** Percentage change from previous close */
  changePercent: number;
  /** Day's opening price */
  open: number;
  /** Previous day's closing price */
  previousClose: number;
  /** Day's highest price */
  high: number;
  /** Day's lowest price */
  low: number;
  /** Trading volume */
  volume: number;
  /** Average volume (30-day) */
  avgVolume: number;
  /** Market capitalization */
  marketCap: number;
  /** PE ratio (if available) */
  peRatio?: number;
  /** 52-week high */
  fiftyTwoWeekHigh?: number;
  /** 52-week low */
  fiftyTwoWeekLow?: number;
  /** Quote timestamp */
  timestamp: Date;
}

/**
 * Historical price data point
 */
export interface HistoricalPrice {
  symbol: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
}

/**
 * Time range for historical data
 */
export type TimeRange = "1d" | "5d" | "1w" | "1m" | "3m" | "6m" | "1y" | "5y" | "max";

// ============================================================================
// Account Types
// ============================================================================

/**
 * Simulated trading account
 */
export interface Account {
  /** Unique account identifier */
  id: string;
  /** Account name */
  name: string;
  /** Account type */
  type: AccountType;
  /** Account status */
  status: AccountStatus;
  /** Available cash balance */
  cashBalance: number;
  /** Total portfolio value (cash + holdings) */
  portfolioValue: number;
  /** Initial capital (for tracking returns) */
  initialCapital: number;
  /** Base currency */
  currency: string;
  /** Account creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

export type AccountType = "paper" | "simulation";
export type AccountStatus = "active" | "frozen" | "closed";

/**
 * Account settings
 */
export interface AccountSettings {
  /** Account ID */
  accountId: string;
  /** Enable margin trading */
  marginEnabled: boolean;
  /** Margin multiplier (e.g., 2x for standard margin) */
  marginMultiplier: number;
  /** Enable short selling */
  shortEnabled: boolean;
  /** Maximum position size as percentage of portfolio */
  maxPositionPercent: number;
  /** Maximum daily loss percentage before auto-freeze */
  maxDailyLossPercent: number;
  /** Default order type */
  defaultOrderType: OrderType;
  /** Currency preference */
  currency: string;
}

// ============================================================================
// Position Types
// ============================================================================

/**
 * Stock position in portfolio
 */
export interface Position {
  /** Unique position identifier */
  id: string;
  /** Account ID */
  accountId: string;
  /** Stock symbol */
  symbol: string;
  /** Number of shares held */
  quantity: number;
  /** Average cost per share */
  averageCost: number;
  /** Total cost basis */
  costBasis: number;
  /** Current market value */
  marketValue: number;
  /** Unrealized profit/loss */
  unrealizedPL: number;
  /** Unrealized profit/loss percentage */
  unrealizedPLPercent: number;
  /** Realized profit/loss from closed trades */
  realizedPL: number;
  /** Position open date */
  openedAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Position summary for portfolio view
 */
export interface PositionSummary {
  /** Total positions count */
  totalPositions: number;
  /** Total market value */
  totalMarketValue: number;
  /** Total cost basis */
  totalCostBasis: number;
  /** Total unrealized P&L */
  totalUnrealizedPL: number;
  /** Top holdings by value */
  topHoldings: Position[];
  /** Best performing position */
  bestPerformer?: Position;
  /** Worst performing position */
  worstPerformer?: Position;
}

// ============================================================================
// Trade Types
// ============================================================================

/**
 * Trade order
 */
export interface Trade {
  /** Unique trade identifier */
  id: string;
  /** Account ID */
  accountId: string;
  /** Stock symbol */
  symbol: string;
  /** Order type */
  orderType: OrderType;
  /** Trade side */
  side: TradeSide;
  /** Number of shares */
  quantity: number;
  /** Limit price (for limit orders) */
  limitPrice?: number;
  /** Stop price (for stop orders) */
  stopPrice?: number;
  /** Executed price */
  executedPrice?: number;
  /** Trade status */
  status: TradeStatus;
  /** Total commission */
  commission: number;
  /** Order creation timestamp */
  createdAt: Date;
  /** Order execution timestamp */
  executedAt?: Date;
  /** Order expiration timestamp (for GTC orders) */
  expiresAt?: Date;
  /** Cancellation reason (if cancelled) */
  cancelReason?: string;
  /** Additional notes */
  notes?: string;
}

export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TradeSide = "buy" | "sell" | "sell_short" | "buy_to_cover";
export type TradeStatus =
  | "pending"
  | "open"
  | "partial"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

/**
 * Trade request (for creating new trades)
 */
export interface TradeRequest {
  /** Account ID */
  accountId: string;
  /** Stock symbol */
  symbol: string;
  /** Order type */
  orderType: OrderType;
  /** Trade side */
  side: TradeSide;
  /** Number of shares */
  quantity: number;
  /** Limit price (required for limit and stop-limit orders) */
  limitPrice?: number;
  /** Stop price (required for stop and stop-limit orders) */
  stopPrice?: number;
  /** Order time in force */
  timeInForce?: TimeInForce;
  /** Additional notes */
  notes?: string;
}

export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

/**
 * Trade validation result
 */
export interface TradeValidation {
  /** Whether the trade is valid */
  isValid: boolean;
  /** Validation errors */
  errors: TradeValidationError[];
  /** Validation warnings */
  warnings: TradeValidationWarning[];
  /** Estimated commission */
  estimatedCommission: number;
  /** Estimated total cost/proceeds */
  estimatedTotal: number;
  /** Buying power impact */
  buyingPowerImpact: number;
}

export interface TradeValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface TradeValidationWarning {
  code: string;
  message: string;
  field?: string;
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Transaction record (audit trail)
 */
export interface Transaction {
  /** Unique transaction identifier */
  id: string;
  /** Account ID */
  accountId: string;
  /** Transaction type */
  type: TransactionType;
  /** Stock symbol (if applicable) */
  symbol?: string;
  /** Trade ID (if associated with a trade) */
  tradeId?: string;
  /** Transaction amount (positive for credits, negative for debits) */
  amount: number;
  /** Balance after transaction */
  balanceAfter: number;
  /** Number of shares (if applicable) */
  quantity?: number;
  /** Price per share (if applicable) */
  price?: number;
  /** Transaction description */
  description: string;
  /** Transaction timestamp */
  timestamp: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "buy"
  | "sell"
  | "dividend"
  | "split"
  | "commission"
  | "interest"
  | "adjustment";

/**
 * Transaction filter options
 */
export interface TransactionFilter {
  /** Account ID */
  accountId: string;
  /** Filter by transaction type */
  type?: TransactionType;
  /** Filter by symbol */
  symbol?: string;
  /** Filter by trade ID */
  tradeId?: string;
  /** Start date (inclusive) */
  startDate?: Date;
  /** End date (inclusive) */
  endDate?: Date;
  /** Minimum amount */
  minAmount?: number;
  /** Maximum amount */
  maxAmount?: number;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

// ============================================================================
// Portfolio Types
// ============================================================================

/**
 * Portfolio (aggregate view of positions)
 */
export interface Portfolio {
  /** Account ID */
  accountId: string;
  /** Account information */
  account: Account;
  /** All positions */
  positions: Position[];
  /** Position summary */
  summary: PositionSummary;
  /** Cash breakdown */
  cash: CashBreakdown;
  /** Portfolio metrics */
  metrics: PortfolioMetrics;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Cash breakdown
 */
export interface CashBreakdown {
  /** Available cash for trading */
  available: number;
  /** Cash reserved for pending orders */
  reserved: number;
  /** Margin buying power (if enabled) */
  marginBuyingPower?: number;
  /** Total cash */
  total: number;
}

/**
 * Portfolio performance metrics
 */
export interface PortfolioMetrics {
  /** Total return (absolute) */
  totalReturn: number;
  /** Total return percentage */
  totalReturnPercent: number;
  /** Daily return percentage */
  dailyReturnPercent: number;
  /** Number of winning positions */
  winners: number;
  /** Number of losing positions */
  losers: number;
  /** Win rate percentage */
  winRate: number;
  /** Sharpe ratio (if enough data) */
  sharpeRatio?: number;
  /** Maximum drawdown percentage */
  maxDrawdown: number;
  /** Portfolio beta (market correlation) */
  beta?: number;
  /** Diversification score (0-100) */
  diversificationScore: number;
}

/**
 * Portfolio allocation by sector/industry
 */
export interface PortfolioAllocation {
  /** Sector name */
  sector: string;
  /** Allocation percentage */
  percent: number;
  /** Total value */
  value: number;
  /** Number of holdings */
  holdings: number;
}

// ============================================================================
// Analytics Types
// ============================================================================

/**
 * Account performance report
 */
export interface PerformanceReport {
  /** Account ID */
  accountId: string;
  /** Report period start */
  startDate: Date;
  /** Report period end */
  endDate: Date;
  /** Starting portfolio value */
  startingValue: number;
  /** Ending portfolio value */
  endingValue: number;
  /** Total return */
  totalReturn: number;
  /** Total return percentage */
  totalReturnPercent: number;
  /** Annualized return percentage */
  annualizedReturn: number;
  /** Number of trades executed */
  totalTrades: number;
  /** Number of winning trades */
  winningTrades: number;
  /** Number of losing trades */
  losingTrades: number;
  /** Average win amount */
  avgWin: number;
  /** Average loss amount */
  avgLoss: number;
  /** Largest win */
  largestWin: number;
  /** Largest loss */
  largestLoss: number;
  /** Win rate percentage */
  winRate: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
  /** Maximum drawdown percentage */
  maxDrawdown: number;
  /** Sharpe ratio */
  sharpeRatio?: number;
  /** Daily returns */
  dailyReturns: DailyReturn[];
}

/**
 * Daily return data point
 */
export interface DailyReturn {
  date: Date;
  portfolioValue: number;
  dailyReturn: number;
  dailyReturnPercent: number;
  cumulativeReturn: number;
  cumulativeReturnPercent: number;
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Stock data API configuration
 */
export interface StockApiConfig {
  /** API provider */
  provider: "yahoo" | "alpha_vantage" | "mock";
  /** API key (if required) */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Maximum retries */
  maxRetries: number;
  /** Enable caching */
  cacheEnabled: boolean;
  /** Cache TTL in seconds */
  cacheTtl: number;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Storage type */
  type: "memory" | "file" | "sqlite";
  /** File path (for file/sqlite storage) */
  path?: string;
  /** Enable auto-save */
  autoSave: boolean;
  /** Auto-save interval in milliseconds */
  autoSaveInterval: number;
}

/**
 * Stock analyzer configuration
 */
export interface StockAnalyzerConfig {
  /** Stock API configuration */
  api: StockApiConfig;
  /** Storage configuration */
  storage: StorageConfig;
  /** Default account settings */
  defaultSettings: Partial<AccountSettings>;
  /** Trading hours (market open/close times) */
  tradingHours: {
    open: string; // e.g., "09:30"
    close: string; // e.g., "16:00"
    timezone: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Stock analyzer error
 */
export class StockAnalyzerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StockAnalyzerError";
  }
}

/**
 * Insufficient funds error
 */
export class InsufficientFundsError extends StockAnalyzerError {
  constructor(required: number, available: number) {
    super(
      `Insufficient funds: required ${required}, available ${available}`,
      "INSUFFICIENT_FUNDS",
      { required, available },
    );
  }
}

/**
 * Invalid trade error
 */
export class InvalidTradeError extends StockAnalyzerError {
  constructor(message: string, errors: TradeValidationError[]) {
    super(message, "INVALID_TRADE", { errors });
  }
}

/**
 * Market closed error
 */
export class MarketClosedError extends StockAnalyzerError {
  constructor() {
    super("Market is currently closed", "MARKET_CLOSED");
  }
}

/**
 * Position not found error
 */
export class PositionNotFoundError extends StockAnalyzerError {
  constructor(symbol: string) {
    super(`Position not found: ${symbol}`, "POSITION_NOT_FOUND", { symbol });
  }
}
