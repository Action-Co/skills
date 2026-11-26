// The chart, year explorer and accessible table all use the server's applied snapshot.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const colors = Array.from({ length: 10 }, (_, i) => `var(--chart-${i + 1})`);
  const money = value => value === null ? 'No observation' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

  function model(analysis) {
    const { from, to, countries } = analysis.scope;
    const observations = analysis.observations;
    const max = Math.max(...observations.map(r => r.value ?? 0), 1);
    const step = 10 ** Math.floor(Math.log10(max));
    const ceiling = Math.ceil(max / step) * step;
    const x = year => 84 + (to === from ? 0.5 : (year - from) / (to - from)) * 772;
    const y = value => 356 - value / ceiling * 304;
    const series = countries.map((code, i) => {
      const rows = observations.filter(r => r.code === code).sort((a, b) => a.year - b.year);
      let connected = false;
      const path = rows.map(r => {
        if (r.value === null) { connected = false; return ''; }
        const command = connected ? 'L' : 'M'; connected = true;
        return `${command}${x(r.year).toFixed(2)},${y(r.value).toFixed(2)}`;
      }).join(' ');
      return { code, name: rows[0]?.entity || code, rows, color: colors[i % colors.length], path };
    });
    return { from, to, x, y, ceiling, series };
  }

  function render(host, analysis) {
    host.replaceChildren();
    const chart = model(analysis);
    const html = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    };
    const svg = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const title = html('h2', 'GDP per capita');
    const subtitle = html('p', 'Inflation-adjusted output per person · constant 2015 US dollars', 'wb-chart-subtitle');
    const legend = html('ul', undefined, 'wb-legend');
    for (const s of chart.series) {
      const item = html('li');
      const swatch = html('span', undefined, 'wb-swatch'); swatch.style.backgroundColor = s.color;
      swatch.setAttribute('aria-hidden', 'true'); item.append(swatch, document.createTextNode(s.name)); legend.append(item);
    }
    const plot = svg('svg', { viewBox: '0 0 900 400', role: 'img', 'aria-label': `GDP per capita for ${chart.series.map(s => s.name).join(', ')}, ${chart.from}–${chart.to}. Use the year slider or data table for exact values.`, class: 'wb-plot' });
    for (let i = 0; i <= 4; i++) {
      const value = chart.ceiling * i / 4, y = chart.y(value);
      plot.append(svg('line', { x1: 84, y1: y, x2: 856, y2: y, class: 'wb-grid' }));
      plot.append(svg('text', { x: 72, y: y + 5, 'text-anchor': 'end', class: 'wb-axis' }, '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)));
    }
    const tickCount = Math.min(5, chart.to - chart.from + 1);
    const years = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(chart.from + (chart.to - chart.from) * i / Math.max(tickCount - 1, 1))))];
    for (const year of years) plot.append(svg('text', { x: chart.x(year), y: 386, 'text-anchor': 'middle', class: 'wb-axis' }, year));
    for (const s of chart.series) {
      plot.append(svg('path', { d: s.path, fill: 'none', stroke: s.color, 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' }));
      for (const r of s.rows.filter(r => r.value !== null)) {
        const dot = svg('circle', { cx: chart.x(r.year), cy: chart.y(r.value), r: 3, fill: s.color });
        dot.append(svg('title', {}, `${s.name}, ${r.year}: ${money(r.value)} (${analysis.unit})`)); plot.append(dot);
      }
    }
    const guide = svg('line', { x1: 0, y1: 52, x2: 0, y2: 356, class: 'wb-guide' }); plot.append(guide);
    const explorer = html('div', undefined, 'wb-explorer');
    const label = html('label', 'Explore year');
    const slider = html('input'); slider.type = 'range'; slider.id = 'wb-explore-year';
    slider.min = chart.from; slider.max = chart.to; slider.step = '1'; slider.value = chart.to;
    label.htmlFor = slider.id;
    const output = html('output'); output.htmlFor = slider.id;
    const readout = html('ul', undefined, 'wb-readout'); readout.setAttribute('aria-live', 'polite');
    const readoutItems = chart.series.map(s => { const item = html('li'); readout.append(item); return item; });
    let exploredYear;
    const explore = year => {
      year = Math.max(chart.from, Math.min(chart.to, year));
      if (year === exploredYear) return;
      exploredYear = year; slider.value = year; output.textContent = year;
      guide.setAttribute('x1', chart.x(year)); guide.setAttribute('x2', chart.x(year));
      chart.series.forEach((s, i) => { readoutItems[i].textContent = `${s.name}: ${money(s.rows.find(r => r.year === year)?.value ?? null)}`; });
      slider.setAttribute('aria-valuetext', `${year}. ${readoutItems.map(el => el.textContent).join('. ')}. Constant 2015 US dollars.`);
    };
    slider.addEventListener('input', () => explore(Number(slider.value)));
    plot.addEventListener('pointermove', event => {
      const box = plot.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width * 900;
      if (x >= 84 && x <= 856) explore(Math.round(chart.from + (x - 84) / 772 * (chart.to - chart.from)));
    });
    explorer.append(label, slider, output);
    const details = html('details', undefined, 'wb-data');
    details.append(html('summary', `View scoped data (${analysis.rows} observations)`));
    const wrap = html('div', undefined, 'wb-table-scroll');
    const table = html('table');
    table.append(html('caption', 'GDP per capita in constant 2015 US dollars. Missing observations are marked explicitly.'));
    const head = html('thead'), hr = html('tr');
    for (const name of ['Country', 'Year', 'GDP per capita']) { const th = html('th', name); th.scope = 'col'; hr.append(th); }
    head.append(hr); table.append(head);
    const body = html('tbody');
    for (const row of analysis.observations) {
      const tr = html('tr');
      for (const text of [row.entity, row.year, money(row.value)]) tr.append(html('td', text));
      body.append(tr);
    }
    table.append(body); wrap.append(table); details.append(wrap);
    host.append(title, subtitle, legend, plot, explorer, readout,
      html('p', 'Hover the chart or use the year slider to inspect values. Apply scope above to change the analysis. Gaps indicate missing observations.', 'scope-note'), details);
    explore(chart.to);
  }
  window.TabbyWorldBankChart = { render, model };
})();
