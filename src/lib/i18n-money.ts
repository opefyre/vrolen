/**
 * VROL-836 — i18n money + locale-aware number formatter.
 *
 * Single-source formatters that wrap `Intl.NumberFormat` so the rest of
 * the app can switch from ad-hoc `(n).toLocaleString("en-US", …)` calls
 * to a single seam. Default locale is `en-US` and default currency is
 * `USD`; both can be overridden per call.
 *
 * The behaviours that matter for downstream callers:
 *   • `formatMoney` always uses the `currency` style — caller picks the
 *     currency code (the formatter picks the right number of decimals
 *     for that currency; JPY → 0 decimals, USD/EUR → 2).
 *   • `formatNumber` is for raw counts / percentages — no currency.
 *   • Non-finite inputs (`NaN`, `Infinity`) collapse to `"—"` rather
 *     than the spec's "NaN" string. Surfaces never need to special-case.
 */

const DEFAULT_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";
const FALLBACK = "—";

export interface FormatMoneyOptions {
  readonly currency?: string;
  readonly locale?: string;
  /**
   * Override the currency's default fraction-digit count. Most callers
   * shouldn't need this — `Intl.NumberFormat` already picks the right
   * value per currency.
   */
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  /** Whether to show the sign for non-negative values. */
  readonly signDisplay?: "auto" | "always" | "exceptZero" | "never";
}

export interface FormatNumberOptions {
  readonly locale?: string;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly style?: "decimal" | "percent";
  readonly signDisplay?: "auto" | "always" | "exceptZero" | "never";
}

export function formatMoney(amount: number, opts: FormatMoneyOptions = {}): string {
  if (!Number.isFinite(amount)) return FALLBACK;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  const formatterOpts: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
  };
  if (opts.minimumFractionDigits !== undefined) {
    formatterOpts.minimumFractionDigits = opts.minimumFractionDigits;
  }
  if (opts.maximumFractionDigits !== undefined) {
    formatterOpts.maximumFractionDigits = opts.maximumFractionDigits;
  }
  if (opts.signDisplay !== undefined) {
    formatterOpts.signDisplay = opts.signDisplay;
  }
  try {
    return new Intl.NumberFormat(locale, formatterOpts).format(amount);
  } catch {
    // Unknown currency / locale code — degrade gracefully.
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: DEFAULT_CURRENCY,
    }).format(amount);
  }
}

export function formatNumber(n: number, opts: FormatNumberOptions = {}): string {
  if (!Number.isFinite(n)) return FALLBACK;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const formatterOpts: Intl.NumberFormatOptions = {
    style: opts.style ?? "decimal",
  };
  if (opts.minimumFractionDigits !== undefined) {
    formatterOpts.minimumFractionDigits = opts.minimumFractionDigits;
  }
  if (opts.maximumFractionDigits !== undefined) {
    formatterOpts.maximumFractionDigits = opts.maximumFractionDigits;
  }
  if (opts.signDisplay !== undefined) {
    formatterOpts.signDisplay = opts.signDisplay;
  }
  try {
    return new Intl.NumberFormat(locale, formatterOpts).format(n);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, formatterOpts).format(n);
  }
}
