// Appearance is selected by the host before HTML or CSS reaches the browser.
import { readFileSync } from "node:fs";

export const THEMES = [
  { id: "action-dark", name: "Action Dark", description: "Blue Raven, bright accents, and Kanit type.", byline: "by The Action Co.", logo: "/logo.svg", font: "https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" },
  { id: "pnc", name: "PNC Bank", description: "Warm orange, slate, and bright surfaces.", byline: "PNC Bank demo", logo: null, font: null },
  { id: "aetna", name: "Aetna", description: "Violet accents and soft, light surfaces.", byline: "Aetna demo", logo: null, font: null },
  { id: "micron", name: "Micron", description: "Silicon-inspired orange on charcoal.", byline: "Micron demo", logo: null, font: null },
  { id: "medical", name: "Medical Company", description: "Calm teal and clear, light surfaces.", byline: "Medical Company demo", logo: null, font: null },
  { id: "banking", name: "Banking Company", description: "Midnight blue with warm gold accents.", byline: "Banking Company demo", logo: null, font: null },
] as const;

export type Appearance = {
  mode: "demo" | "fixed";
  defaultTheme: string;
  themes: readonly (typeof THEMES)[number][];
};

export function createAppearance(fixedTheme?: string): Appearance {
  if (fixedTheme === undefined || fixedTheme === "") {
    return { mode: "demo", defaultTheme: "action-dark", themes: THEMES };
  }
  const theme = THEMES.find(({ id }) => id === fixedTheme);
  if (!theme) throw new Error(`Unknown TABBY_THEME: ${fixedTheme}. Choose ${THEMES.map(t => t.id).join(", ")}.`);
  return { mode: "fixed", defaultTheme: theme.id, themes: [theme] };
}

// Each theme owns a complete declaration block. Fixed mode serves only that block,
// so neither an old browser preference nor an Action :root rule can take over.
const stylesheet = readFileSync(new URL("./themes.css", import.meta.url), "utf8");
const blocks = new Map([...stylesheet.matchAll(/\/\* theme:([\w-]+) \*\/([\s\S]*?)(?=\/\* theme:|$)/g)].map(m => [m[1], m[2].trim()]));

export function appearanceCss(appearance: Appearance): string {
  return appearance.themes.map(({ id }) => {
    const block = blocks.get(id);
    if (!block) throw new Error(`Missing CSS for theme ${id}`);
    return block;
  }).join("\n\n");
}

export function appearanceScript(appearance: Appearance): string {
  return `window.TabbyAppearance = ${JSON.stringify(appearance)};`;
}

export function appearancePage(html: string, appearance: Appearance): string {
  const theme = appearance.themes.find(t => t.id === appearance.defaultTheme)!;
  const brand = theme.logo
    ? `<img id="brand-logo" src="${theme.logo}" alt="Action" onerror="this.hidden=true">`
    : '<img id="brand-logo" alt="" hidden>';
  return html.replace("__TABBY_THEME__", theme.id)
    .replace("<!-- TABBY_BRAND -->", `<span class="brand-mark">${brand}</span><div class="brand-copy"><div class="name">Tabby</div><div class="by" id="brand-by">${theme.byline}</div></div>`);
}
