/**
 * Trading Engine Tests
 * Unit tests for the trading engine orchestration
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StockDataClient } from "../../data/stock_data_client/stock_data_client";
import {
  AccountStatus,
  TransactionType,
  OrderStatus,
} from "../../data/trading_repository/trading_data_models";
import { TradingRepository } from "../../data/trading_repository/trading_repository";
import { TradingEngine } from "./trading_engine";

describe("TradingEngine", () => {
  let tradingEngine: TradingEngine;
  let repository: TradingRepository;
  let stockDataClient: StockDataClient;

  beforeEach(() => {
    repository = new TradingRepository();
    stockDataClient = new StockDataClient();
    tradingEngine = new TradingEngine(repository, stockDataClient);
  });

  describe("Account Management", () => {
    it("should create a new account with initial balance", async () => {
      const account = await tradingEngine.createAccount({
        name: "Test Account",
        initialBalance: 10000,
      });

      expect(account).toBeDefined();
      expect(account.name).toBe("Test Account");
      expect(account.initialBalance).toBe(10000);
      expect(account.balance).toBe(10000);
      expect(account.status).toBe(AccountStatus.ACTIVE);
    });

    it("should reject account with empty name", async () => {
      await expect(
        tradingEngine.createAccount({
          name: "",
          initialBalance: 10000,
        }),
      ).rejects.toThrow("Account name is required");
    });

    it("should reject account with negative balance", async () => {
      await expect(
        tradingEngine.createAccount({
          name: "Test",
          initialBalance: -1000,
        }),
      ).rejects.toThrow("Initial balance must be non-negative");
    });

    it("should retrieve account by ID", async () => {
      const created = await tradingEngine.createAccount({
        name: "Test Account",
        initialBalance: 5000,
      });

      const retrieved = await tradingEngine.getAccountInfo(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.balance).toBe(5000);
    });

    it("should return null for non-existent account", async () => {
      const result = await tradingEngine.getAccountInfo("non-existent");
      expect(result).toBeNull();
    });

    it("should delete account", async () => {
      const account = await tradingEngine.createAccount({
        name: "To Delete",
        initialBalance: 1000,
      });

      const deleted = await tradingEngine.deleteAccount(account.id);
      expect(deleted).toBe(true);

      const retrieved = await tradingEngine.getAccountInfo(account.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("Trading Operations", () => {
    let accountId: string;

    beforeEach(async () => {
      const account = await tradingEngine.createAccount({
        name: "Trading Test",
        initialBalance: 100000,
      });
      accountId = account.id;
    });

    it("should execute a buy order successfully", async () => {
      const result = await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      expect(result.success).toBe(true);
      expect(result.stockCode).toBe("AAPL");
      expect(result.quantity).toBe(10);
      expect(result.executionPrice).toBeGreaterThan(0);
      expect(result.transactionId).toBeDefined();
    });

    it("should deduct balance after buy order", async () => {
      const initialBalance = (await tradingEngine.getAccountInfo(accountId))!.balance;

      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      const updatedBalance = (await tradingEngine.getAccountInfo(accountId))!.balance;
      expect(updatedBalance).toBeLessThan(initialBalance);
    });

    it("should fail buy order with insufficient balance", async () => {
      const result = await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10000, // Too many shares
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient balance");
    });

    it("should fail buy order with zero quantity", async () => {
      const result = await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be greater than 0");
    });

    it("should execute sell order after buying", async () => {
      // First buy some shares
      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      // Then sell them
      const result = await tradingEngine.executeSellOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 5,
      });

      expect(result.success).toBe(true);
      expect(result.quantity).toBe(5);
    });

    it("should fail sell order without holdings", async () => {
      const result = await tradingEngine.executeSellOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient shares");
    });

    it("should fail sell order with insufficient shares", async () => {
      // Buy 10 shares
      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      // Try to sell 20 shares
      const result = await tradingEngine.executeSellOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 20,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient shares");
    });
  });

  describe("Portfolio Management", () => {
    let accountId: string;

    beforeEach(async () => {
      const account = await tradingEngine.createAccount({
        name: "Portfolio Test",
        initialBalance: 100000,
      });
      accountId = account.id;
    });

    it("should return empty portfolio initially", async () => {
      const portfolio = await tradingEngine.getPortfolio(accountId);

      expect(portfolio.holdings).toHaveLength(0);
      expect(portfolio.totalCost).toBe(0);
      expect(portfolio.totalMarketValue).toBe(0);
    });

    it("should update portfolio after buy order", async () => {
      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      const portfolio = await tradingEngine.getPortfolio(accountId);

      expect(portfolio.holdings).toHaveLength(1);
      expect(portfolio.holdings[0].stockCode).toBe("AAPL");
      expect(portfolio.holdings[0].quantity).toBe(10);
    });

    it("should calculate portfolio value correctly", async () => {
      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      const portfolio = await tradingEngine.getPortfolio(accountId);

      expect(portfolio.totalMarketValue).toBeGreaterThan(0);
      expect(portfolio.totalValue).toBe(portfolio.availableBalance + portfolio.totalMarketValue);
    });
  });

  describe("Market Data", () => {
    it("should search for stocks", async () => {
      const results = await tradingEngine.searchStocks("AAPL");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].symbol).toBe("AAPL");
    });

    it("should get stock quote", async () => {
      const quote = await tradingEngine.getStockQuote("AAPL");

      expect(quote.symbol).toBe("AAPL");
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.volume).toBeGreaterThan(0);
    });

    it("should throw error for non-existent stock", async () => {
      await expect(tradingEngine.getStockQuote("NONEXISTENT")).rejects.toThrow("Stock not found");
    });
  });

  describe("Performance Metrics", () => {
    let accountId: string;

    beforeEach(async () => {
      const account = await tradingEngine.createAccount({
        name: "Performance Test",
        initialBalance: 100000,
      });
      accountId = account.id;
    });

    it("should calculate performance metrics", async () => {
      const metrics = await tradingEngine.getPerformanceMetrics(accountId);

      expect(metrics.accountId).toBe(accountId);
      expect(metrics.initialBalance).toBe(100000);
      expect(metrics.totalTrades).toBe(0);
    });

    it("should track trades count", async () => {
      await tradingEngine.executeBuyOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      await tradingEngine.executeSellOrder({
        accountId,
        stockCode: "AAPL",
        quantity: 10,
      });

      const metrics = await tradingEngine.getPerformanceMetrics(accountId);
      expect(metrics.totalTrades).toBe(1); // Only sell counts as a trade
    });
  });
});
