// 팀 간 연결 지도: 팀을 원 둘레에 놓고, 결과물이 가는 방향으로 화살표를 그려요 (외부 라이브러리 없이 SVG).
// 화살표 위 번호는 아래 목록의 번호와 같아요. 같은 방향 연결이 여러 개면 번호를 묶어서 하나의 화살표로 그려요.
import { html, raw, escapeHtml } from './ui.js';

const W = 460;
const H = 540;
const NW = 124;   // 팀 상자 크기
const NH = 50;

// 팀 이름을 두 줄 이하로 줄여요. 괄호 안 설명은 빼요.
export function shortTeamName(name) {
  const base = String(name || '').split(/[(（]/)[0].trim() || String(name || '');
  const words = base.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + w).length <= 8) lines[lines.length - 1] = `${cur} ${w}`;
    else lines.push(w);
  }
  if (lines.length > 2) {
    lines.length = 2;
    lines[1] = `${lines[1].slice(0, 7)}…`;
  }
  return lines.map((l) => (l.length > 9 ? `${l.slice(0, 8)}…` : l));
}

// 상자 가장자리에서 선이 나가는 점
function edge(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t = Math.min(dx ? (NW / 2 + 4) / Math.abs(dx) : Infinity, dy ? (NH / 2 + 4) / Math.abs(dy) : Infinity);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

export function linkMap(teams, links) {
  if (!teams.length) return html`<p class="muted">팀이 없어요.</p>`;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W / 2 - NW / 2 - 10;
  const ry = H / 2 - NH / 2 - 10;
  const pos = new Map(teams.map((t, i) => {
    const a = -Math.PI / 2 + (i / teams.length) * Math.PI * 2;
    return [t.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }];
  }));

  // 번호는 목록 순서(1부터). 같은 방향끼리 묶어요.
  const groups = new Map();
  links.forEach((l, i) => {
    if (!pos.has(l.from_team) || !pos.has(l.to_team)) return;
    const key = `${l.from_team}>${l.to_team}`;
    if (!groups.has(key)) groups.set(key, { from: l.from_team, to: l.to_team, nums: [], whats: [] });
    groups.get(key).nums.push(i + 1);
    groups.get(key).whats.push(l.what);
  });

  const arrows = [...groups.values()].map((g) => {
    const a = pos.get(g.from);
    const b = pos.get(g.to);
    let p1 = edge(a, b);
    let p2 = edge(b, a);
    // 반대 방향 연결도 있으면 두 선이 겹치지 않게 옆으로 살짝 비켜요.
    if (groups.has(`${g.to}>${g.from}`)) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ox = (-(b.y - a.y) / len) * 7;
      const oy = ((b.x - a.x) / len) * 7;
      p1 = { x: p1.x + ox, y: p1.y + oy };
      p2 = { x: p2.x + ox, y: p2.y + oy };
    }
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const label = g.nums.join(',');
    const bw = Math.max(20, label.length * 8 + 10);
    const from = teams.find((t) => t.id === g.from).name;
    const to = teams.find((t) => t.id === g.to).name;
    return `<g class="lm-link" data-from="${g.from}" data-to="${g.to}">
        <title>${escapeHtml(`${from} → ${to}: ${g.whats.join(', ')}`)}</title>
        <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" marker-end="url(#lm-arrow)"/>
        <rect class="lm-num-bg" x="${mx - bw / 2}" y="${my - 10}" width="${bw}" height="20" rx="10"/>
        <text class="lm-num" x="${mx}" y="${my + 4}" text-anchor="middle">${escapeHtml(label)}</text>
      </g>`;
  }).join('');

  const nodes = teams.map((t) => {
    const p = pos.get(t.id);
    const lines = shortTeamName(t.name);
    const used = links.some((l) => l.from_team === t.id || l.to_team === t.id);
    return `<g class="lm-node ${used ? '' : 'alone'}" data-team="${t.id}">
        <title>${escapeHtml(t.name)}</title>
        <rect x="${p.x - NW / 2}" y="${p.y - NH / 2}" width="${NW}" height="${NH}" rx="10"/>
        ${lines.map((l, i) => `<text x="${p.x}" y="${p.y + 5 + (i - (lines.length - 1) / 2) * 17}" text-anchor="middle">${escapeHtml(l)}</text>`).join('')}
      </g>`;
  }).join('');

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" class="linkmap" role="img" aria-label="팀 간 연결 지도: 연결 ${links.length}개">
      <defs>
        <marker id="lm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z"/>
        </marker>
      </defs>
      ${arrows}
      ${nodes}
    </svg>`;
  return html`<div class="linkmap-wrap">${raw(svg)}</div>`;
}

// 목록 (번호는 지도 위 번호와 같아요)
export function linkList(teams, links, { canEdit } = {}) {
  if (!links.length) return html`<p class="muted">아직 연결이 없어요.</p>`;
  const name = (id) => teams.find((t) => t.id === id)?.name || '(꺼진 팀)';
  return html`<ol class="link-list">
    ${links.map((l, i) => html`
      <li data-id="${l.id}">
        <span class="lm-no">${i + 1}</span>
        <span><strong>${name(l.from_team)}</strong> → <strong>${name(l.to_team)}</strong> · ${l.what}</span>
        ${canEdit && canEdit(l) ? html`<button type="button" class="link-button danger-text small" data-del-link="${l.id}">지우기</button>` : ''}
      </li>`)}
  </ol>`;
}

// 팀 상자를 누르거나 손가락을 대면 그 팀의 연결만 진하게 보여요.
export function bindLinkMap(root) {
  root.querySelectorAll('svg.linkmap').forEach((svg) => {
    const focus = (team) => {
      svg.classList.toggle('focusing', Boolean(team));
      svg.querySelectorAll('.lm-link').forEach((g) => {
        g.classList.toggle('on', Boolean(team) && (g.dataset.from === team || g.dataset.to === team));
      });
      svg.querySelectorAll('.lm-node').forEach((g) => g.classList.toggle('on', g.dataset.team === team));
    };
    svg.addEventListener('pointerover', (e) => {
      const node = e.target.closest('.lm-node');
      if (node) focus(node.dataset.team);
    });
    svg.addEventListener('pointerleave', () => focus(null));
    svg.addEventListener('pointerdown', (e) => { if (!e.target.closest('.lm-node')) focus(null); });
  });
}
