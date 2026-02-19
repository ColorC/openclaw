/**
 * Trading UI
 * Main UI component that orchestrates all trading interface views
 */

import { ITradingService } from "../../business/trading_engine/trading_engine";
import {
  AccountFormState,
  OrderFormState,
  StockSearchState,
  AccountViewModel,
  PortfolioViewModel,
  TransactionViewModel,
  PerformanceViewModel,
  QuoteViewModel,
  UINotification,
  formatters,
  converters,
} from "./ui_types";

/**
 * Trading UI Controller
 * Provides UI methods and data transformation for the presentation layer
 */
export class TradingUI {
  private tradingService: ITradingService;
  private notifications: UINotification[];

  constructor(tradingService: ITradingService) {
    this.tradingService = tradingService;
    this.notifications = [];
  }

  // ==================== Account Management ====================

  /**
   * Validate account form
   */
  validateAccountForm(form: AccountFormState): AccountFormState {
    const errors: Record<string, string> = {};

    if (!form.name || form.name.trim() === "") {
      errors.name = "Account name is required";
    }

    const balance = parseFloat(form.initialBalance);
    if (isNaN(balance)) {
      errors.initialBalance = "Initial balance must be a valid number";
    } else if (balance < 0) {
      errors.initialBalance = "Initial balance must be non-negative";
    }

    return {
      ...form,
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Create account from form
   */
  async createAccount(form: AccountFormState): Promise<{
    success: boolean;
    account?: AccountViewModel;
    error?: string;
  }> {
    const validated = this.validateAccountForm(form);
    if (!validated.isValid) {
      return {
        success: false,
        error: Object.values(validated.errors).join(", "),
      };
    }

    try {
      const account = await this.tradingService.createAccount({
        name: form.name.trim(),
        initialBalance: parseFloat(form.initialBalance),
      });

      this.addNotification("success", `Account "${account.name}" created successfully`);

      return {
        success: true,
        account: converters.toAccountViewModel(account),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.addNotification("error", message);
      return { success: false, error: message };
    }
  }

  /**
   * Get account view model
   */
  async getAccountDisplay(accountId: string): Promise<AccountViewModel | null> {
    const account = await this.tradingService.getAccountInfo(accountId);
    if (!account) {
      return null;
    }
    return converters.toAccountViewModel(account);
  }

  /**
   * Get all accounts
   */
  async getAllAccounts(): Promise<AccountViewModel[]> {
    const accounts = await this.tradingService.getAllAccounts();
    return accounts.map(converters.toAccountViewModel);
  }

  /**
   * Delete account
   */
  async deleteAccount(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await this.tradingService.deleteAccount(accountId);
      if (success) {
        this.addNotification("success", "Account deleted successfully");
      }
      return { success };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.addNotification("error", message);
      return { success: false, error: message };
    }
  }

  // ==================== Order Management ====================

  /**
   * Validate order form
   */
  validateOrderForm(form: OrderFormState): OrderFormState {
    const errors: Record<string, string> = {};

    if (!form.stockCode || form.stockCode.trim() === "") {
      errors.stockCode = "Stock code is required";
    }

    const quantity = parseInt(form.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      errors.quantity = "Quantity must be a positive integer";
    }

    if (form.price) {
      const price = parseFloat(form.price);
      if (isNaN(price) || price <= 0) {
        errors.price = "Price must be a positive number";
      }
    }

    return {
      ...form,
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Execute buy order
   */
  async executeBuy(
    accountId: string,
    form: OrderFormState,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const validated = this.validateOrderForm(form);
    if (!validated.isValid) {
      return {
        success: false,
        error: Object.values(validated.errors).join(", "),
      };
    }

    try {
      const result = await this.tradingService.executeBuyOrder({
        accountId,
        stockCode: form.stockCode.trim().toUpperCase(),
        quantity: parseInt(form.quantity),
        maxPrice: form.price ? parseFloat(form.price) : undefined,
        notes: form.notes,
      });

      if (result.success) {
        this.addNotification(
          "success",
          `Bought ${result.quantity} shares of ${result.stockCode} at ${formatters.currency(result.executionPrice)}`,
        );
      } else {
        this.addNotification("error", result.error || "Order failed");
      }

      return { success: result.success, result, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.addNotification("error", message);
      return { success: false, error: message };
    }
  }

  /**
   * Execute sell order
   */
  async executeSell(
    accountId: string,
    form: OrderFormState,
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const validated = this.validateOrderForm(form);
    if (!validated.isValid) {
      return {
        success: false,
        error: Object.values(validated.errors).join(", "),
      };
    }

    try {
      const result = await this.tradingService.executeSellOrder({
        accountId,
        stockCode: form.stockCode.trim().toUpperCase(),
        quantity: parseInt(form.quantity),
        minPrice: form.price ? parseFloat(form.price) : undefined,
        notes: form.notes,
      });

      if (result.success) {
        this.addNotification(
          "success",
          `Sold ${result.quantity} shares of ${result.stockCode} at ${formatters.currency(result.executionPrice)}`,
        );
      } else {
        this.addNotification("error", result.error || "Order failed");
      }

      return { success: result.success, result, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.addNotification("error", message);
      return { success: false, error: message };
    }
  }

  // ==================== Portfolio Display ====================

  /**
   * Get portfolio view
   */
  async getPortfolioDisplay(accountId: string): Promise<PortfolioViewModel | null> {
    try {
      const portfolio = await this.tradingService.getPortfolio(accountId);
      return converters.toPortfolioViewModel(portfolio);
    } catch (error) {
      console.error("Failed to load portfolio:", error);
      return null;
    }
  }

  // ==================== Transaction History ====================

  /**
   * Get transaction history
   */
  async getTransactionHistoryDisplay(
    accountId: string,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ): Promise<TransactionViewModel[]> {
    try {
      const history = await this.tradingService.getTransactionHistory(
        accountId,
        startDate,
        endDate,
        limit,
      );
      return history.transactions.map(converters.toTransactionViewModel);
    } catch (error) {
      console.error("Failed to load transaction history:", error);
      return [];
    }
  }

  // ==================== Performance Analytics ====================

  /**
   * Get performance report
   */
  async getPerformanceDisplay(accountId: string): Promise<PerformanceViewModel | null> {
    try {
      const report = await this.tradingService.getPerformanceMetrics(accountId);
      return converters.toPerformanceViewModel(report);
    } catch (error) {
      console.error("Failed to load performance metrics:", error);
      return null;
    }
  }

  // ==================== Market Data ====================

  /**
   * Search stocks
   */
  async searchStocks(query: string, limit?: number): Promise<StockSearchState> {
    if (!query || query.trim() === "") {
      return {
        query: "",
        isSearching: false,
        results: [],
      };
    }

    try {
      const results = await this.tradingService.searchStocks(query, limit);
      return {
        query,
        isSearching: false,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed";
      return {
        query,
        isSearching: false,
        results: [],
        error: message,
      };
    }
  }

  /**
   * Get stock quote
   */
  async getQuoteDisplay(stockCode: string): Promise<QuoteViewModel | null> {
    try {
      const quote = await this.tradingService.getStockQuote(stockCode);
      return converters.toQuoteViewModel(quote);
    } catch (error) {
      console.error("Failed to load quote:", error);
      return null;
    }
  }

  // ==================== Notifications ====================

  /**
   * Add notification
   */
  private addNotification(type: UINotification["type"], message: string): void {
    this.notifications.push({
      type,
      message,
      timestamp: new Date(),
    });

    // Keep only last 10 notifications
    if (this.notifications.length > 10) {
      this.notifications = this.notifications.slice(-10);
    }
  }

  /**
   * Get notifications
   */
  getNotifications(): UINotification[] {
    return [...this.notifications];
  }

  /**
   * Clear notifications
   */
  clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get latest notification
   */
  getLatestNotification(): UINotification | null {
    return this.notifications.length > 0 ? this.notifications[this.notifications.length - 1] : null;
  }
}
