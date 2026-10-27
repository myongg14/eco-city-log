import { html, render } from '../ui.js';
import { fetchPeople, fetchResearch, SOURCE_TYPES } from '../records.js';
import { researchCard } from './cards.js';

// 자료실: 모든 팀의 이론 조사 자료를 한곳에서 찾아봐요.
export async function libraryView(el, ctx) {
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let people, notes;
  try {
    [people, notes] = await Promise.all([fetchPeople(), fetchResearch()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  render(el, html`
    <section class="card">
      <h1 class="title">자료실</h1>
      <p class="muted">모든 팀이 모은 이론 조사 자료예요. 다른 팀 자료도 우리 모형에 쓸 수 있는지 살펴보세요.</p>
      <div class="filters">
        <input id="lib-q" type="search" placeholder="제목, 내용, 출처로 찾기">
        <select id="lib-type"><option value="">모든 출처 종류</option>${SOURCE_TYPES.map((t) => html`<option>${t}</option>`)}</select>
        <select id="lib-team"><option value="">모든 팀</option>${teams.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select>
      </div>
      <p class="hint" id="lib-count"></p>
      <div class="timeline" id="lib-list"></div>
    </section>
  `);

  const q = el.querySelector('#lib-q');
  const type = el.querySelector('#lib-type');
  const team = el.querySelector('#lib-team');
  const listEl = el.querySelector('#lib-list');
  const countEl = el.querySelector('#lib-count');
  const cardCtx = { people, teams, meId: ctx.state.me.user_id };

  function draw() {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = notes.filter((n) => {
      if (type.value && n.source_type !== type.value) return false;
      if (team.value && String(n.team_id) !== team.value) return false;
      const hay = [n.title, n.summary, n.application, n.new_question, n.source_author, n.source_publisher,
        people.get(n.author_id)?.display_name].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    countEl.textContent = `${notes.length}개 중 ${rows.length}개`;
    render(listEl, rows.length
      ? html`${rows.map((n) => researchCard(n, cardCtx))}`
      : html`<p class="muted">${notes.length ? '찾는 자료가 없어요.' : '아직 올라온 자료가 없어요.'}</p>`);
  }
  [q, type, team].forEach((c) => c.addEventListener('input', draw));
  draw();
}
