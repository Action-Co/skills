import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { THEMES, createAppearance, appearanceCss, appearancePage, appearanceScript } from "./appearance.ts";

const browserScript = await Bun.file(new URL("./themes.js", import.meta.url)).text();
const template = await Bun.file(new URL("./index.html", import.meta.url)).text();

function boot(fixedTheme?: string, stored: string | null = null, storageBlocked = false) {
  const appearance = createAppearance(fixedTheme);
  const dataset: Record<string, string> = {};
  const links: { id?: string; href?: string }[] = [];
  let reads = 0;
  runInNewContext(appearanceScript(appearance) + browserScript, {
    window: {},
    document: {
      documentElement: { dataset },
      getElementById: () => null,
      createElement: () => ({}),
      head: { append: (link: object) => links.push(link) },
      addEventListener() {},
    },
    localStorage: { getItem() { reads++; if (storageBlocked) throw new Error("Storage blocked"); return stored; } },
  });
  return { appearance, selected: dataset.theme, reads, links };
}

test("demo restores a valid theme before painting, and tolerates stale or unavailable storage", () => {
  expect(boot(undefined, "aetna").selected).toBe("aetna");
  expect(boot(undefined, "removed-theme").selected).toBe("action-dark");
  expect(boot(undefined, null, true).selected).toBe("action-dark");
  expect(boot(undefined, "aetna").links).toHaveLength(0);
  expect(boot().links[0].href).toContain("Kanit");
});

test("fixed company mode ignores demo storage and serves no Action theme or branding", () => {
  for (const theme of THEMES.filter(t => t.id !== "action-dark")) {
    const result = boot(theme.id, "action-dark");
    expect(result.selected).toBe(theme.id);
    expect(result.reads).toBe(0);
    expect(result.links).toHaveLength(0);
    expect(result.appearance.themes.map(t => t.id)).toEqual([theme.id]);
    const css = appearanceCss(result.appearance);
    expect(css).toContain(`data-theme="${theme.id}"`);
    expect(css).not.toContain('data-theme="action-dark"');
    expect(css).not.toContain("#0A1044");
    const html = appearancePage(template, result.appearance);
    expect(html).toContain(`<html lang="en" data-theme="${theme.id}">`);
    expect(html).not.toContain("by The Action Co.");
    expect(html).not.toContain('src="/logo.svg"');
    expect(appearanceScript(result.appearance)).not.toContain("Kanit");
    expect(appearanceScript(result.appearance)).not.toContain("action-dark");
  }
  expect(() => createAppearance("misspelled-company")).toThrow("Unknown TABBY_THEME");
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f\d]{2}/gi)!.map(c => parseInt(c, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("each company theme is complete and readable without inherited Action values", () => {
  const declarations = (id: string) => new Map([...appearanceCss(createAppearance(id)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const required = [...declarations("action-dark").keys()].sort();
  for (const theme of THEMES) {
    const vars = declarations(theme.id);
    expect([...vars.keys()].sort()).toEqual(required);
    for (const surface of ["--surface", "--surface-raised"]) {
      for (const text of ["--text", "--text-muted", "--link", "--subhead"]) {
        expect(contrast(vars.get(text)!, vars.get(surface)!), `${theme.id}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(vars.get("--ring")!, vars.get(surface)!), `${theme.id}: focus ring`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(vars.get("--primary")!, vars.get("--on-primary")!), `${theme.id}: button label`).toBeGreaterThanOrEqual(4.5);
    for (let i = 1; i <= 10; i++) {
      expect(contrast(vars.get(`--chart-${i}`)!, vars.get("--surface")!), `${theme.id}: chart series ${i}`).toBeGreaterThanOrEqual(3);
    }
  }
});
