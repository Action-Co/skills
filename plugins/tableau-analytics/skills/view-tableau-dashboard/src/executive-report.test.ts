/**
 * executive-report.test.ts — the daily executive summary HTML renderer.
 * Pure logic, no bridge: given ReportCards (values or errors) it produces the
 * self-contained prose report with one section per card and inline error boxes.
 */

import { expect, test } from "bun:test";
import {
  renderExecutiveSummary,
  renderExecutiveSummaryDetailed,
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

test("renderExecutiveSummary produces one section per card with prose", () => {
  const cards: ReportCard[] = [
    { name: "overview", title: "Overview", subtitle: "margins", value: overviewValue },
    { name: "customers", title: "Customers", subtitle: "accounts", value: customersValue },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html.split("<section").length - 1).toBe(2);
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

test("escapes data values — markup in a field renders as text, never as HTML", () => {
  const cards: ReportCard[] = [
    {
      name: "customers",
      title: "Customers",
      subtitle: "",
      value: {
        groups: [
          {
            category: "<b>Cat</b>",
            segment: "Corp & Co",
            top3: [{ name: "<img src=x onerror=alert(1)>", sales: 1, ratio: 0.1 }],
          },
        ],
      },
    },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("&lt;b&gt;Cat&lt;/b&gt;");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).not.toContain("<b>Cat</b>");
  expect(html).not.toContain("<img src=x");
});

test("a null shipping row does not abort the report; sibling cards still render", () => {
  const cards: ReportCard[] = [
    { name: "shipping", title: "Shipping", subtitle: "", value: [null] },
    { name: "customers", title: "Customers", subtitle: "", value: customersValue },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("no ship-mode results returned");
  expect(html).toContain("Seth Vernon");
  expect(html.split("<section").length - 1).toBe(2);
});

test("missing values render as an em dash, not a believable zero", () => {
  const cards: ReportCard[] = [
    {
      name: "commission",
      title: "Commission",
      subtitle: "",
      value: { compByRate: [{ rate: 6, oteAvg: null, oteTotal: null, topEarner: null }], quotaSweep: [] },
    },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("<td>—</td>");
  expect(html).not.toContain("<td>$0</td>");
});

test("a real zero still renders as zero", () => {
  const cards: ReportCard[] = [
    {
      name: "shipping",
      title: "Shipping",
      subtitle: "",
      value: [{ shipMode: "Same Day", delay: 0, orderId: "x", product: "p", shipStatus: "Shipped On Time" }],
    },
  ];
  expect(renderExecutiveSummary(cards)).toContain("0 day");
});

test("overview surfaces an incomplete (capped) ranking", () => {
  const cards: ReportCard[] = [
    {
      name: "overview",
      title: "Overview",
      subtitle: "",
      value: { ...overviewValue, complete: false, note: "capped at 10000 rows" },
    },
  ];
  const html = renderExecutiveSummary(cards);
  expect(html).toContain("capped at 10000 rows");
  expect(html).toContain("⚠");
});

test("renderExecutiveSummaryDetailed reports per-card outcomes for the workflow status", () => {
  const cards: ReportCard[] = [
    { name: "overview", title: "Overview", subtitle: "", value: overviewValue },
    { name: "customers", title: "Customers", subtitle: "", value: { ...customersValue, complete: false, note: "capped" } },
    { name: "shipping", title: "Shipping", subtitle: "", error: "session dropped" },
    { name: "nope", title: "No renderer", subtitle: "", value: {} },
  ];
  const { outcomes } = renderExecutiveSummaryDetailed(cards);
  expect(outcomes.find((o) => o.name === "overview")?.status).toBe("ok");
  expect(outcomes.find((o) => o.name === "customers")?.status).toBe("partial");
  expect(outcomes.find((o) => o.name === "customers")?.detail).toBe("capped");
  expect(outcomes.find((o) => o.name === "shipping")?.status).toBe("error");
  expect(outcomes.find((o) => o.name === "nope")?.status).toBe("error");
});