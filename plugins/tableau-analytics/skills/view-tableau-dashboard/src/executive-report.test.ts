/**
 * executive-report.test.ts — the daily executive summary HTML renderer.
 * Pure logic, no bridge: given ReportCards (values or errors) it produces the
 * self-contained prose report with one section per card and inline error boxes.
 */

import { expect, test } from "bun:test";
import {
  renderExecutiveSummary,
  WORKFLOW_REPORT_NAME,
  type ReportCard,
} from "./executive-report.ts";

const overviewValue = {
  headline: {
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[sum:Sales:qk]": 2326534,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[sum:Profit:qk]": 292296,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[sum:Quantity:qk]": 38654,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[avg:Discount:qk]": 0.155,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[usr:Calculation_9921103144103743:qk]": 0.1256,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[usr:Calculation_9321103144526191:qk]": 2908.17,
    "[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[usr:Sales per Customer (copy):qk]": 57.19,
  },
  topByRatio: [{ name: "Delaware", sales: 27451, profit: 9977, ratio: 0.3635 }],
  bottomByRatio: [{ name: "Ohio", sales: 78258, profit: -16971, ratio: -0.2169 }],
  topBySales: [{ name: "California", sales: 457687, profit: 76381, ratio: 0.1669 }],
  totalStates: 59,
};

const customersValue = {
  groups: [
    {
      category: "Technology",
      segment: "Corporate",
      top3: [{ name: "Seth Vernon", sales: 8332, profit: 688, ratio: 0.0826 }],
    },
  ],
  liveVerified: [{ category: "Technology", segment: "Corporate", top3Names: ["Seth Vernon"] }],
};

const forecastValue = {
  baseline: { actualTotal: 2326534 },
  scenarios: [
    { growth: 0.12, churn: 0.09, forecastTotal: 2371203, upliftPct: 1.9, topRegion: "West" },
    { growth: 0.3, churn: 0.03, forecastTotal: 2933759, upliftPct: 26.1, topRegion: "West" },
  ],
};

test("renderExecutiveSummary produces one section per card with prose", () => {
  const cards: ReportCard[] = [
    { name: "overview", title: "Overview", subtitle: "margins", value: overviewValue },
    { name: "customers", title: "Customers", subtitle: "accounts", value: customersValue },
    { name: "forecast", title: "Forecast", subtitle: "scenarios", value: forecastValue },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html.split("<section").length - 1).toBe(3);
  expect(html).toContain("Superstore — Daily Executive Summary");

  // friendly labels, not LUID-qualified schema names
  expect(html).toContain("Sales $2,326,534");
  expect(html).toContain("Profit Ratio 12.6%");
  expect(html).toContain("Average Discount 15.5%");
  expect(html).toContain("Quantity 38,654");
  expect(html).not.toContain("[federated.");
  expect(html).not.toContain("sum:Quantity:qk");

  // narrative prose with the answer inline
  expect(html).toContain("Global company KPIs");
  expect(html).toContain("Delaware 36.35%");
  expect(html).toContain("Ohio -21.69%");
  expect(html).toContain("Seth Vernon");
  expect(html).toContain("+1.9% vs actual");
  expect(html).toContain("+26.1% vs actual");
});

test("renderExecutiveSummary renders error cards as inline error boxes", () => {
  const cards: ReportCard[] = [
    { name: "overview", title: "Overview", subtitle: "", error: "scriptResult status !== ok" },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("class=\"error\"");
  expect(html).toContain("scriptResult status !== ok");
});

test("renderExecutiveSummary falls back to the card title when no renderer exists", () => {
  const cards: ReportCard[] = [
    { name: "custom", title: "Custom dashboard", subtitle: "unknown", value: { a: 1 } },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("Custom dashboard");
  expect(html).toContain("no renderer for step 'custom'");
});

test("workflow report name is the artifact served by the bridge", () => {
  expect(WORKFLOW_REPORT_NAME).toBe("daily-executive-summary.html");
});