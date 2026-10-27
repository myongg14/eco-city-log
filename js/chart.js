// 측정값 꺾은선 그래프 (외부 라이브러리 없이 SVG). 측정 1묶음 = 선 1개라서 범례는 두지 않아요.
import { html, raw, escapeHtml } from './ui.js';

const W = 640;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 44, left: 52 };

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const raw0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function fmt(n) {
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

export function lineChart(m) {
  const pts = (m.points || []).map((p) => ({ x: String(p.x), y: Number(p.y), note: p.note || '' }));
  if (!pts.length) return html`<p class="muted small">측정값이 없어요.</p>`;
  const numericX = pts.every((p) => p.x.trim() !== '' && !Number.isNaN(Number(p.x)));
  const xs = numericX ? pts.map((p) => Number(p.x)) : pts.map((_, i) => i);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const ticks = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const sx = (v) => PAD.left + (xMax === xMin ? iw / 2 : ((v - xMin) / (xMax - xMin)) * iw);
  const sy = (v) => PAD.top + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const unit = m.unit ? ` ${m.unit}` : '';
  const coords = pts.map((p, i) => ({ ...p, cx: sx(xs[i]), cy: sy(p.y) }));
  // x 눈금이 너무 많으면 몇 개만 보여 줘요.
  const every = Math.ceil(coords.length / 8);
  const last = coords[coords.length - 1];

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${escapeHtml(`${m.title}: ${m.x_label}별 ${m.y_label}`)}">
      ${ticks.map((t) => `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${sy(t)}" y2="${sy(t)}"/>
        <text class="tick" x="${PAD.left - 8}" y="${sy(t) + 4}" text-anchor="end">${escapeHtml(fmt(t))}</text>`).join('')}
      ${coords.map((c, i) => (i % every === 0 || i === coords.length - 1
        ? `<text class="tick" x="${c.cx}" y="${H - PAD.bottom + 18}" text-anchor="middle">${escapeHtml(c.x.length > 8 ? `${c.x.slice(0, 7)}…` : c.x)}</text>` : '')).join('')}
      <text class="axis-label" x="${PAD.left + iw / 2}" y="${H - 6}" text-anchor="middle">${escapeHtml(m.x_label)}</text>
      <text class="axis-label" x="12" y="${PAD.top + ih / 2}" text-anchor="middle" transform="rotate(-90 12 ${PAD.top + ih / 2})">${escapeHtml(`${m.y_label}${m.unit ? ` (${m.unit})` : ''}`)}</text>
      <polyline class="line" points="${coords.map((c) => `${c.cx},${c.cy}`).join(' ')}"/>
      ${coords.map((c, i) => `<circle class="dot" cx="${c.cx}" cy="${c.cy}" r="4.5" data-i="${i}"/>`).join('')}
      <text class="end-label" x="${Math.min(last.cx + 8, W - PAD.right)}" y="${last.cy - 8}" text-anchor="${last.cx > W - 80 ? 'end' : 'start'}">${escapeHtml(fmt(last.y) + unit)}</text>
      <line class="cross" x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + ih}" visibility="hidden"/>
      <rect class="hit" x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}"/>
    </svg>`;

  return html`
    <div class="chart-wrap" data-points="${JSON.stringify(coords.map((c) => ({ x: c.x, y: c.y, cx: c.cx, note: c.note })))}" data-unit="${unit}">
      ${raw(svg)}
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table"><summary>표로 보기</summary>
      <table class="table"><thead><tr><th>${m.x_label}</th><th>${m.y_label}${m.unit ? ` (${m.unit})` : ''}</th><th>메모</th></tr></thead>
        <tbody>${pts.map((p) => html`<tr><td>${p.x}</td><td>${fmt(p.y)}</td><td>${p.note}</td></tr>`)}</tbody></table>
    </details>`;
}

// 그래프 위에서 손가락·마우스를 움직이면 가장 가까운 점의 값을 보여 줘요.
export function bindCharts(root) {
  root.querySelectorAll('.chart-wrap').forEach((wrap) => {
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    const pts = JSON.parse(wrap.dataset.points);
    const svg = wrap.querySelector('svg');
    const tip = wrap.querySelector('.chart-tip');
    const cross = svg.querySelector('.cross');
    const dots = svg.querySelectorAll('.dot');
    const show = (ev) => {
      const box = svg.getBoundingClientRect();
      const x = ((ev.clientX - box.left) / box.width) * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(p.cx - x) < Math.abs(pts[best].cx - x)) best = i; });
      const p = pts[best];
      cross.setAttribute('x1', p.cx);
      cross.setAttribute('x2', p.cx);
      cross.setAttribute('visibility', 'visible');
      dots.forEach((d, i) => d.classList.toggle('on', i === best));
      tip.textContent = `${p.x}: ${Number(p.y).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}${wrap.dataset.unit}${p.note ? ` · ${p.note}` : ''}`;
      tip.hidden = false;
      const left = (p.cx / W) * box.width;
      tip.style.left = `${Math.min(Math.max(left, 60), box.width - 60)}px`;
    };
    const hide = () => {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.classList.remove('on'));
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  });
}
