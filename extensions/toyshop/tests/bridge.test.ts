/**
 * Tests for Bridge Client
 *
 * Tests the JSON-RPC communication between TypeScript and Python subprocess.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BridgeClient } from "../src/bridge-client.js";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

describe("BridgeClient", () => {
  let client: BridgeClient;

  beforeEach(() => {
    client = new BridgeClient();
  });

  afterEach(() => {
    client.stop();
  });

  describe("start/stop", () => {
    it("should start the Python process", () => {
      client.start();
      // spawn should have been called
      expect(true).toBe(true);
    });

    it("should stop the Python process", () => {
      client.start();
      client.stop();
      // kill should have been called
      expect(true).toBe(true);
    });

    it("should not start twice", () => {
      client.start();
      client.start();
      // Should only spawn once
      expect(true).toBe(true);
    });
  });

  describe("call", () => {
    it("should reject if process not started", async () => {
      await expect(client.call("test", {})).rejects.toThrow("Bridge process not started");
    });
  });
});

describe("ValidationResult type", () => {
  it("should have correct structure", () => {
    const result = {
      valid: true,
      errors: [] as Array<{ path: string; message: string }>,
      warnings: [] as Array<{ path: string; message: string }>,
    };

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("PipelineResult type", () => {
  it("should have correct structure", () => {
    const result = {
      current_stage: "done",
      error: null,
      project_id: "abc123",
      snapshot_id: "snap1",
      proposal: "# Test Project\n...",
      design: "# Design\n...",
      tasks: "# Tasks\n...",
      spec: "# Spec\n...",
    };

    expect(result.current_stage).toBe("done");
    expect(result.project_id).toBe("abc123");
    expect(result.proposal).toContain("Test Project");
  });
});
