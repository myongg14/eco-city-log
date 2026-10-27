import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchLinks } from '../records.js';
import { field, selectField } from '../form.js';
import { linkMap, linkList, bindLinkMap } from '../linkmap.js';

// 팀 간 연결 지도: 어느 팀의 결과물이 어느 팀에 필요한지
export async function linksView(el, ctx) {
  const me = ctx.state.me;
  const teams = (ctx.state.teams || []).filter((t) => t.is_active);
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let links;
  try {
    links = await fetchLinks();
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const canEdit = (l) => isStaff || l.from_team === me.team_id;
  const fromChoices = isStaff ? teams : teams.filter((t) => t.id === me.team_id);

  render(el, html`
    <section class="card">
      <a href="#/teams" class="link small">← 팀</a>
      <h1 class="title">팀 간 연결 지도</h1>
      <p class="muted">화살표는 결과물이 가는 방향이에요. 예를 들어 발전 설비 팀이 만든 전기가 배터리 팀으로 가면 발전 설비 → 배터리예요. 팀 상자에 마우스나 손가락을 대면 그 팀의 연결만 진하게 보여요.</p>
      ${linkMap(teams, links)}
      <h2 class="subtitle">연결 목록</h2>
      <div id="lk-list">${linkList(teams, links, { canEdit })}</div>
    </section>

    ${fromChoices.length ? html`
      <section class="card">
        <details>
          <summary>+ 연결 추가</summary>
          <form id="lk-form" novalidate>
            <div class="field-row">
              ${selectField({ name: 'from_team', label: '보내는 팀', required: true, value: me.team_id,
                options: fromChoices.map((t) => ({ value: t.id, label: t.name })) })}
              ${selectField({ name: 'to_team', label: '받는 팀', required: true,
                options: teams.filter((t) => isStaff || t.id !== me.team_id).map((t) => ({ value: t.id, label: t.name })) })}
            </div>
            ${field({ name: 'what', label: '주고받는 것', required: true, placeholder: '예: 발전한 전기, 차량 위치 정보, 도로 배치도' })}
            ${isStaff ? '' : html`<p class="hint">우리 팀에서 보내는 연결만 추가하고 지울 수 있어요. 받아야 하는 게 있으면 팀 간 요청 게시판에 부탁해 보세요.</p>`}
            <p class="message" id="lk-msg" hidden></p>
            <button type="submit" class="primary" id="lk-btn">연결 추가</button>
          </form>
        </details>
      </section>` : ''}
  `);
  bindLinkMap(el);

  el.querySelector('#lk-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-link]');
    if (!del || !window.confirm('이 연결을 지울까요?')) return;
    try {
      await rpc('delete_team_link', { p_id: Number(del.dataset.delLink) });
      toast('연결을 지웠어요.');
      linksView(el, ctx);
    } catch (err) {
      toast(err.message);
    }
  });

  const form = el.querySelector('#lk-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#lk-msg');
    const btn = el.querySelector('#lk-btn');
    const v = (n) => form.elements[n].value.trim();
    const data = { from_team: v('from_team'), to_team: v('to_team'), what: v('what') };
    if (!data.from_team || !data.to_team || !data.what) return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    if (data.from_team === data.to_team) return showMessage(msg, '서로 다른 팀을 골라 주세요.');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_team_link', { p_id: null, p_data: data });
      toast('연결을 추가했어요.');
      linksView(el, ctx);
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
}
