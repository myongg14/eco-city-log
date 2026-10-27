import { html, render } from '../ui.js';
import { fetchPeople, fetchTasks, fetchPurchases, fetchResearch, fetchLogs, personName, formatDate, won, SPENT_STATUSES } from '../records.js';
import { sb, friendlyError } from '../api.js';
import { taskCard } from './tasks.js';

function progress(tasks) {
  if (!tasks.length) return null;
  return Math.round((tasks.filter((t) => t.status === '완료').length / tasks.length) * 100);
}

function bar(pct) {
  return html`<div class="progress" role="img" aria-label="진행률 ${pct ?? 0}%"><span style="width:${pct ?? 0}%"></span></div>`;
}

async function loadAll() {
  const plans = await sb.from('plans').select('user_id');
  if (plans.error) throw new Error(friendlyError(plans.error));
  const [people, tasks, purchases, research, logs] = await Promise.all([
    fetchPeople(), fetchTasks(), fetchPurchases(), fetchResearch(), fetchLogs(),
  ]);
  return { people, tasks, purchases, research, logs, planned: new Set(plans.data.map((p) => p.user_id)) };
}

// 팀 목록: 팀별 진행률, 기록 수, 쓴 예산
export async function teamsView(el, ctx) {
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let d;
  try {
    d = await loadAll();
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  render(el, html`
    <section class="card">
      <h1 class="title">팀</h1>
      <p class="muted">팀을 누르면 팀원, 할 일, 최근 기록, 쓴 예산을 볼 수 있어요. 진행률은 할 일 보드에서 완료한 비율이에요.</p>
    </section>
    <div class="team-grid">
      ${teams.map((t) => {
        const members = [...d.people.values()].filter((p) => p.team_id === t.id && p.role === 'student');
        const pct = progress(d.tasks.filter((x) => x.team_id === t.id));
        const spent = d.purchases.filter((p) => p.team_id === t.id && SPENT_STATUSES.includes(p.status)).reduce((s, p) => s + p.total_price, 0);
        return html`
          <a class="card team-card ${t.is_active ? '' : 'off'}" href="#/team/${t.id}">
            <span class="team-code">team${t.id}${t.is_active ? '' : ' · 꺼짐'}</span>
            <strong>${t.name}</strong>
            ${t.topic ? html`<span class="muted small">${t.topic}</span>` : ''}
            ${bar(pct)}
            <span class="muted small">진행률 ${pct === null ? '할 일 없음' : `${pct}%`} · 팀원 ${members.length}명</span>
            <span class="muted small">일지 ${d.logs.filter((l) => l.team_id === t.id).length} · 조사 ${d.research.filter((r) => r.team_id === t.id).length} · 쓴 예산 ${won(spent)}</span>
          </a>`;
      })}
    </div>
  `);
}

// 팀 페이지
export async function teamView(el, ctx, teamId) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const team = teams.find((t) => t.id === Number(teamId));
  if (!team) {
    render(el, html`<section class="card"><p class="message error">그 팀을 찾을 수 없어요.</p></section>`);
    return;
  }
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let d;
  try {
    d = await loadAll();
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const members = [...d.people.values()].filter((p) => p.team_id === team.id && p.role === 'student');
  const tasks = d.tasks.filter((t) => t.team_id === team.id);
  const pct = progress(tasks);
  const purchases = d.purchases.filter((p) => p.team_id === team.id);
  const spent = purchases.filter((p) => SPENT_STATUSES.includes(p.status)).reduce((s, p) => s + p.total_price, 0);
  const recent = [
    ...d.logs.filter((l) => l.team_id === team.id).map((l) => ({ when: l.created_at, day: l.log_date, kind: `일지 · ${l.activity_type}`, text: String(l.did).split('\n')[0], who: l.author_id })),
    ...d.research.filter((r) => r.team_id === team.id).map((r) => ({ when: r.created_at, day: r.created_at, kind: '이론 조사', text: r.title, who: r.author_id })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 8);

  render(el, html`
    <section class="card">
      <a href="#/teams" class="link small">← 모든 팀</a>
      <h1 class="title">${team.name}</h1>
      ${team.topic ? html`<p class="muted">${team.topic}</p>` : ''}
      ${bar(pct)}
      <div class="stats four">
        <div class="stat"><span class="stat-label">진행률</span><strong class="stat-value small">${pct === null ? '-' : `${pct}%`}</strong></div>
        <div class="stat"><span class="stat-label">팀원</span><strong class="stat-value small">${members.length}명</strong></div>
        <div class="stat"><span class="stat-label">기록</span><strong class="stat-value small">${d.logs.filter((l) => l.team_id === team.id).length + d.research.filter((r) => r.team_id === team.id).length}개</strong></div>
        <div class="stat"><span class="stat-label">쓴 예산</span><strong class="stat-value small">${won(spent)}</strong></div>
      </div>
    </section>

    <section class="card">
      <h2 class="subtitle">팀원</h2>
      <ul class="members">
        ${members.map((p) => html`
          <li>
            <a href="#/records?u=${encodeURIComponent(p.login_id)}"><strong>${p.display_name || '(이름 없음)'}</strong> <span class="muted small">${p.login_id}</span></a>
            <span class="small">${d.planned.has(p.user_id) ? html`<span class="badge ok">계획서 ✓</span>` : html`<span class="badge warn">계획서 아직</span>`}
              일지 ${d.logs.filter((l) => l.author_id === p.user_id).length} · 조사 ${d.research.filter((r) => r.author_id === p.user_id).length}</span>
          </li>`)}
      </ul>
    </section>

    <section class="card">
      <div class="title-row"><h2 class="subtitle">할 일</h2><a class="link small" href="#/tasks?f=${me.role === 'student' ? 'team' : `t${team.id}`}">할 일 보드</a></div>
      ${tasks.filter((t) => t.status !== '완료').length
        ? html`<div class="timeline">${tasks.filter((t) => t.status !== '완료').map((t) => taskCard(t, { people: d.people, teams, me, compact: true }))}</div>`
        : html`<p class="muted">남은 할 일이 없어요.</p>`}
    </section>

    <section class="card">
      <h2 class="subtitle">최근 기록</h2>
      ${recent.length ? html`
        <ul class="recent">
          ${recent.map((r) => html`<li><span class="badge">${r.kind}</span><span class="recent-text">${r.text.length > 50 ? `${r.text.slice(0, 50)}…` : r.text}</span>
            <span class="muted small">${personName(d.people, r.who)} · ${formatDate(r.day)}</span></li>`)}
        </ul>` : html`<p class="muted">아직 기록이 없어요.</p>`}
    </section>

    <section class="card">
      <div class="title-row"><h2 class="subtitle">물품</h2><a class="link small" href="#/supplies">물품 신청</a></div>
      ${purchases.length ? html`
        <ul class="recent">
          ${purchases.map((p) => html`<li><span class="badge">${p.status}</span><span class="recent-text">${p.item_name}</span><span class="muted small">${won(p.total_price)}</span></li>`)}
        </ul>` : html`<p class="muted">신청한 물품이 없어요.</p>`}
    </section>
  `);
}
