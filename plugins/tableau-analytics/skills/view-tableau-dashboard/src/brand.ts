/**
 * brand.ts — the Action-branded page shell for reports.
 *
 * Every report this skill produces (the daily executive summary and reports
 * an agent writes with `tableau-viz report`) renders through brandedPage(),
 * so they share one look: Kanit type, the Action palette, dark (Blue Raven) on
 * screen and light (Background) when printed or exported to PDF.
 *
 * Brand source: The Action Co. Brand Book (May 2025), via the action-brand
 * skill. Only palette hex values are used; tertiary colors appear only for the
 * small error marker (a functional status need).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_ROOT } from "./session.ts";

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Official Action logo files, if someone has added them. The brand forbids
 * redrawing the logo, so without them the page carries a labeled placeholder.
 * Copy action_icon-white.svg and action_icon-raven.svg from the Drive Logo
 * folder (SVG → Standard) into assets/.
 */
export const LOGO_FILES = {
  dark: join(SKILL_ROOT, "assets", "action_icon-white.svg"),
  light: join(SKILL_ROOT, "assets", "action_icon-raven.svg"),
};

function logoMarkup(): string {
  const dark = existsSync(LOGO_FILES.dark) ? readFileSync(LOGO_FILES.dark, "utf8") : "";
  const light = existsSync(LOGO_FILES.light) ? readFileSync(LOGO_FILES.light, "utf8") : "";
  if (!dark && !light) {
    return "<!-- ACTION LOGO: add the official action_icon-white.svg and action_icon-raven.svg to assets/. Never redraw it. -->";
  }
  return `<div class="logo" aria-label="Action">${dark ? `<span class="on-dark">${dark}</span>` : ""}${
    light ? `<span class="on-light">${light}</span>` : ""
  }</div>`;
}

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">';

/**
 * Brand tokens and report styles. Dark is the on-screen default; the light
 * theme applies to print/PDF and to `data-theme="light"`.
 */
export const BRAND_CSS = `
  :root {
    color-scheme: dark;
    --surface: #0A1044; --surface-raised: #222856; --surface-sunk: #060C2E; --surface-alt: #242B59;
    --border: #3F446C; --text: #F4FBFF; --text-muted: #9496AD;
    --headline: #FFFFFF; --subhead: #00CDEA; --link: #00CDEA; --rule: #00CDEA;
    --table-head: #0A1044; --table-head-text: #FFFFFF;
    --danger: #EC482D;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --surface: #F4FBFF; --surface-raised: #FFFFFF; --surface-sunk: #F4FBFF; --surface-alt: #F4FBFF;
    --border: #D8E9F4; --text: #0A1044; --text-muted: #525676;
    --headline: #0A1044; --subhead: #4655E4; --link: #2A2AC6; --rule: #4655E4;
    --table-head: #0A1044; --table-head-text: #FFFFFF;
  }
  * { box-sizing: border-box; }
  html { font-size: 16px; }
  body {
    margin: 0; background: var(--surface); color: var(--text);
    font-family: 'Kanit', system-ui, sans-serif; font-weight: 300; line-height: 1.6;
  }
  a { color: var(--link); }
  .page-head { padding: 48px 40px 32px; border-bottom: 1px solid var(--border); }
  .page-head .inner, main, .page-foot .inner { max-width: 1040px; margin: 0 auto; }
  .page-head .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .eyebrow { margin: 0 0 8px; font-size: .75rem; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--subhead); }
  h1 { margin: 0; font-size: 2.4rem; font-weight: 700; line-height: 1.15; color: var(--headline); }
  .page-head .sub { margin: 10px 0 0; font-size: 1.125rem; font-weight: 500; color: var(--subhead); }
  .page-head .meta { margin: 12px 0 0; font-size: .875rem; color: var(--text-muted); }
  .logo { flex: none; }
  .logo svg { display: block; height: 40px; width: auto; }
  .logo .on-light { display: none; }
  main { padding: 32px 40px 64px; }
  section, .card {
    background: var(--surface-raised); border: 1px solid var(--border); border-top: 3px solid var(--rule);
    padding: 24px 28px; margin: 0 0 24px;
  }
  h2 { margin: 0 0 4px; font-size: 1.5rem; font-weight: 700; line-height: 1.25; color: var(--headline); }
  main > h2 { margin-top: 32px; }
  h3 { margin: 20px 0 6px; font-size: 1.125rem; font-weight: 600; color: var(--subhead); }
  .subtitle { margin: 0 0 16px; font-size: .75rem; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
  p { margin: 10px 0; }
  p.lead { font-weight: 400; font-size: 1.0625rem; }
  strong, b { font-weight: 600; }
  ul, ol { margin: 10px 0; padding-left: 22px; }
  li { margin: 6px 0; }
  .note { margin: 12px 0 0; font-size: .875rem; color: var(--text-muted); }
  .error { display: flex; align-items: baseline; gap: 10px; margin: 10px 0; font-weight: 400; }
  .error::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); transform: translateY(-1px); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
  .kpi { background: var(--surface-alt); border: 1px solid var(--border); padding: 12px 16px; }
  .kpi .k { font-size: .75rem; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
  .kpi .v { margin-top: 2px; font-size: 1.375rem; font-weight: 700; color: var(--headline); font-variant-numeric: tabular-nums; }
  .table-wrap { overflow-x: auto; margin: 12px 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: .9375rem; font-variant-numeric: tabular-nums; }
  th { background: var(--table-head); color: var(--table-head-text); font-weight: 600; text-align: left; padding: 9px 12px; }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td:first-child { font-weight: 500; }
  tbody tr:nth-child(even) td { background: var(--surface-alt); }
  th[align="right"], td[align="right"] { text-align: right; }
  th[align="center"], td[align="center"] { text-align: center; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: .875em; background: var(--surface-sunk); padding: 1px 5px; }
  blockquote { margin: 16px 0; padding: 4px 0 4px 16px; border-left: 3px solid var(--rule); font-weight: 500; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
  .page-foot { background: #222856; color: #9496AD; padding: 20px 40px 24px; font-size: .875rem; }

  /* Print and PDF: the light theme, flat, with page-friendly breaks. */
  @page { size: Letter; margin: 14mm 12mm; }
  @media print {
    :root {
      color-scheme: light;
      --surface: #FFFFFF; --surface-raised: #FFFFFF; --surface-sunk: #F4FBFF; --surface-alt: #F4FBFF;
      --border: #D8E9F4; --text: #0A1044; --text-muted: #525676;
      --headline: #0A1044; --subhead: #4655E4; --link: #2A2AC6; --rule: #4655E4;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html { font-size: 12px; }
    .page-head { padding: 0 0 18px; }
    main { padding: 18px 0 0; }
    section, .card { padding: 14px 0 6px; border: 0; border-top: 2px solid var(--rule); }
    .logo .on-dark { display: none; }
    .logo .on-light { display: block; }
    h2, h3, .subtitle { break-after: avoid; }
    tr, .kpi { break-inside: avoid; }
    .table-wrap { overflow: visible; }
    .page-foot { background: none; color: var(--text-muted); padding: 18px 0 0; border-top: 1px solid var(--border); }
  }
  @media (max-width: 700px) {
    .page-head { padding: 32px 20px 24px; }
    main { padding: 24px 20px 48px; }
    section, .card { padding: 20px; }
    h1 { font-size: 2rem; }
  }
`;

export interface BrandedPage {
  /** Headline (Kanit Bold) at the top of the page. */
  title: string;
  /** Optional subhead under the title. */
  subtitle?: string;
  /** Small label above the title, e.g. "Superstore · Tableau". */
  eyebrow?: string;
  /** Body HTML. Callers escape their own content. */
  body: string;
  /** Footer line. */
  footer?: string;
  generatedAt?: Date;
}

export function brandedPage(page: BrandedPage): string {
  const when = (page.generatedAt ?? new Date()).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
${FONTS}
<style>${BRAND_CSS}</style>
</head>
<body>
<header class="page-head">
  <div class="inner">
    <div class="top">
      <div>
        ${page.eyebrow ? `<p class="eyebrow">${esc(page.eyebrow)}</p>` : ""}
        <h1>${esc(page.title)}</h1>
        ${page.subtitle ? `<p class="sub">${esc(page.subtitle)}</p>` : ""}
        <p class="meta">Generated ${esc(when)}</p>
      </div>
      ${logoMarkup()}
    </div>
  </div>
</header>
<main>${page.body}</main>
<footer class="page-foot"><div class="inner">${esc(page.footer ?? "Prepared with Tabby by The Action Co.")}</div></footer>
</body>
</html>`;
}
