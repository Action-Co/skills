import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

const script = await Bun.file(new URL("./world-bank-chart.js", import.meta.url)).text();
const window: { TabbyWorldBankChart?: { model: (a: unknown) => any } } = {};
runInNewContext(script, { window, Intl });
const model = window.TabbyWorldBankChart!.model;

test("World Bank chart preserves null gaps and plots the same applied years and values", () => {
  const chart = model({ scope: { countries: ["CAN"], from: 2000, to: 2002 }, observations: [
    { entity: "Canada", code: "CAN", year: 2000, value: 30000 },
    { entity: "Canada", code: "CAN", year: 2001, value: null },
    { entity: "Canada", code: "CAN", year: 2002, value: 32000 },
  ] });
  expect(chart.series[0].path.match(/M/g)).toHaveLength(2);
  expect(chart.series[0].path).not.toContain("L");
  expect(chart.series[0].rows[1].value).toBeNull();
  expect(chart.x(2000)).toBe(84);
  expect(chart.x(2002)).toBe(856);
  expect(chart.y(0)).toBe(356);
  // Browser CSS recolors the existing paths; changing themes need not rebuild
  // the chart, reset the year explorer, or fetch a different snapshot.
  expect(chart.series[0].color).toBe("var(--chart-1)");
});

test("single-year World Bank scopes are centered and retain legitimate zero values", () => {
  const chart = model({ scope: { countries: ["CAN"], from: 2020, to: 2020 }, observations: [{ entity: "Canada", code: "CAN", year: 2020, value: 0 }] });
  expect(chart.x(2020)).toBe(470);
  expect(chart.series[0].path).toBe("M470.00,356.00");
});
