// DEX Intelligence tab: asks /api/intel/ask and renders the canned answer
// (reasoning steps, SQL + result table, bar chart, final answer, follow-ups).
// The backend's tables and charts are fixed SAMPLE data, so they're labeled.

const $ = id => document.getElementById(id);

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minimal markdown: ### headings, **bold**, `code`, line breaks. Input is escaped first.
function md(s) {
  return esc(s)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function renderTable(result) {
  const cols = result.schema.fields.map(f => f.name);
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const rows = result.data.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('');
  return `<div class="intel-table-wrap"><table class="intel-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Bar chart from a vega-lite bar spec, drawn with plain divs (no chart library).
function renderChart(spec) {
  const { x, y } = spec.encoding;
  const vals = spec.data.values;
  const max = Math.max(...vals.map(v => Number(v[y.field]) || 0)) || 1;
  const color = spec.mark?.color || 'var(--accent)';
  const bars = vals.map(v => {
    const n = Number(v[y.field]) || 0;
    return `<div class="intel-bar-row">
      <span class="intel-bar-lbl">${esc(v[x.field])}</span>
      <span class="intel-bar-track"><span class="intel-bar" style="width:${(n / max) * 100}%;background:${esc(color)}"></span></span>
      <span class="intel-bar-val">${n.toLocaleString()}</span>
    </div>`;
  }).join('');
  return `<div class="intel-chart"><div class="intel-chart-title">${esc(y.title || y.field)} by ${esc(x.title || x.field)}</div>${bars}</div>`;
}

function render(query, messages) {
  const out = [];
  let suggestions = [];
  for (const { systemMessage: m } of messages) {
    if (m.text?.textType === 'THOUGHT') {
      out.push(`<ul class="intel-thoughts">${m.text.parts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`);
    } else if (m.text?.textType === 'FINAL_RESPONSE') {
      out.push(`<div class="intel-answer">${m.text.parts.map(md).join('<br>')}</div>`);
    } else if (m.text) {
      suggestions = m.text.parts; // untyped text = follow-up questions
    } else if (m.data) {
      if (m.data.generatedSql) {
        out.push(`<details class="intel-sql"><summary>Query</summary><pre>${esc(m.data.generatedSql)}</pre></details>`);
      }
      if (m.data.result?.schema) out.push(renderTable(m.data.result));
    } else if (m.chart?.result?.vegaConfig) {
      out.push(renderChart(m.chart.result.vegaConfig));
    }
  }
  $('intelResult').innerHTML =
    `<div class="intel-q">${esc(query)}</div>
     <div class="intel-sample">Sample data — illustrative figures, not live on-chain results.</div>` +
    out.join('');
  renderSuggestions(suggestions);
}

function renderSuggestions(list) {
  const box = $('intelSuggest');
  box.innerHTML = '';
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'src-chip active';
    b.textContent = s;
    b.onclick = () => ask(s);
    box.appendChild(b);
  }
}

async function ask(query) {
  query = (query ?? $('intelInput').value).trim();
  if (!query) return;
  $('intelInput').value = query;
  $('intelResult').innerHTML = '<div class="status"><span class="spinner"></span>Analyzing…</div>';
  try {
    const r = await fetch('/api/intel/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `API ${r.status}`);
    render(query, j.messages || []);
  } catch (e) {
    $('intelResult').innerHTML = `<div class="status error">Failed: ${esc(e.message.slice(0, 120))}</div>`;
  }
}

$('intelAsk').onclick = () => ask();
$('intelInput').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
renderSuggestions([
  'How does 1inch Pathfinder split capital?',
  'Show Aerodrome ve(3,3) pools by 24h volume',
  'Explain 0xSplits post-swap distribution',
]);
