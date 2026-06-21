/**
 * VROL-836 — formatter smoke tests. Covers the five cases the audit called
 * out: USD positive, USD negative, EUR, JPY no-decimals, NaN guard.
 *
 * Asserts are tolerant to `Intl.NumberFormat`'s non-breaking-space quirks
 * (en-US separates currency symbol from value with U+00A0 for some codes)
 * by matching on digits + currency symbol independently rather than the
 * raw string.
 */

import { describe, expect, it } from "vitest";

import { formatMoney, formatNumber } from "./i18n-money";

describe("formatMoney", () => {
  it("formats positive USD with two decimals", () => {
    const out = formatMoney(1234.5);
    // "$1,234.50"
    expect(out).toContain("$");
    expect(out).toContain("1,234.50");
  });

  it("formats negative USD with minus prefix", () => {
    const out = formatMoney(-99.99);
    expect(out).toMatch(/-/);
    expect(out).toContain("99.99");
  });

  it("formats EUR with the euro symbol", () => {
    const out = formatMoney(1234.5, { currency: "EUR", locale: "en-US" });
    expect(out).toContain("€");
    expect(out).toContain("1,234.50");
  });

  it("formats JPY with no decimals", () => {
    const out = formatMoney(1234, { currency: "JPY", locale: "en-US" });
    // JPY default fraction-digits = 0; output should be e.g. "¥1,234".
    expect(out).toContain("¥");
    expect(out).toContain("1,234");
    expect(out).not.toMatch(/\.\d/); // no fractional digits anywhere
  });

  it("guards against NaN / Infinity by returning the em-dash fallback", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});

describe("formatNumber", () => {
  it("formats decimals with locale grouping by default", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("supports percent style", () => {
    const out = formatNumber(0.125, { style: "percent", maximumFractionDigits: 1 });
    expect(out).toContain("%");
    expect(out).toContain("12.5");
  });

  it("falls back to em-dash on non-finite input", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
  });
});
