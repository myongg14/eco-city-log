import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { fetchRequests, fetchReplies, fetchPeople, personName } from '../records.js';
import { field, selectField } from '../form.js';

// 팀 간 요청 게시판 (?f=to|from|open|all)
export async function requestsView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStaff = me.role !== 'student';
  const filter = params.get('f') || (isStaff ? 'open' : 'to');
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let requests, replies, people;
  try {
    [requests, replies, people] = await Promise.all([fetchRequests(), fetchReplies(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const teamName = (id) => teams.find((t) => t.id === id)?.name || (id ? `team${id}` : '관리자·선생님');
  const shown = requests.filter((r) => (filter === 'to' ? r.to_team === me.team_id
    : filter === 'from' ? r.from_team === me.team_id && me.team_id
    : filter === 'open' ? r.status === '열림' : true));
  const canResolve = (r) => isStaff || r.author_id === me.user_id || r.to_team === me.team_id;
  const tab = (f, label, n) => html`<a href="#/requests?f=${f}" class="${filter === f ? 'active' : ''}">${label}${n ? ` ${n}` : ''}</a>`;
  const openTo = requests.filter((r) => r.to_team === me.team_id && r.status === '열림').length;

  render(el, html`
    <section class="card">
      <a href="#/teams" class="link small">← 팀</a>
      <h1 class="title">팀 간 요청 게시판</h1>
      <p class="muted">다른 팀에 사양을 묻거나 도움을 요청해요. 예: “배터리 팀, ESS 출력 전압이 몇 V예요?” 답을 받으면 ‘해결’로 바꿔 주세요.</p>
      <div class="tabs scroll">
        ${isStaff ? '' : tab('to', '우리 팀이 받은 요청', openTo)}
        ${isStaff ? '' : tab('from', '우리 팀이 보낸 요청')}
        ${tab('open', '열린 요청')}
        ${tab('all', '전체')}
      </div>
      <details id="rq-new">
        <summary>+ 다른 팀에 요청하기</summary>
        <form id="rq-form" novalidate>
          ${selectField({ name: 'to_team', label: '요청할 팀', required: true, options: teams.filter((t) => t.is_active && t.id !== me.team_id).map((t) => ({ value: t.id, label: t.name })) })}
          ${field({ name: 'title', label: '요청 제목', required: true, placeholder: '예: ESS 출력 전압이 몇 V인가요?' })}
          ${field({ name: 'body', label: '자세한 내용', required: true, type: 'textarea', rows: 3, placeholder: '예: 가로등 회로를 설계하려고 해요. 출력 전압과 최대 전류를 알려 주세요. 11/10까지 필요해요.' })}
          <p class="message" id="rq-msg" hidden></p>
          <button type="submit" class="primary" id="rq-btn">요청 올리기</button>
        </form>
      </details>
    </section>

    <div class="timeline" id="rq-list">
      ${shown.length ? shown.map((r) => html`
        <section class="card request ${r.status === '해결' ? 'resolved' : ''}" data-id="${r.id}">
          <div class="title-row">
            <h2 class="subtitle">${r.title}</h2>
            <span class="badge ${r.status === '해결' ? 'ok' : 'warn'}">${r.status}</span>
          </div>
          <p class="muted small">${teamName(r.from_team)} → <strong>${teamName(r.to_team)}</strong> · ${personName(people, r.author_id)} · ${formatDateTime(r.created_at)}</p>
          <p class="pre">${r.body}</p>
          <div class="comments">
            ${(replies.get(r.id) || []).map((a) => html`
              <div class="comment">
                <p class="comment-head"><strong>${personName(people, a.author_id)}</strong>
                  <span class="muted small">${teamName(people.get(a.author_id)?.team_id)} · ${formatDateTime(a.created_at)}</span>
                  ${a.author_id === me.user_id || isStaff ? html`<button type="button" class="link-button small" data-del-reply="${a.id}">지우기</button>` : ''}</p>
                <p class="pre">${a.body}</p>
              </div>`)}
            <form class="comment-form reply-form">
              <textarea name="body" rows="2" maxlength="2000" placeholder="답변 남기기"></textarea>
              <button type="submit" class="secondary small">답변</button>
            </form>
          </div>
          <div class="row-actions">
            ${canResolve(r) ? html`<button type="button" class="${r.status === '열림' ? 'primary' : 'secondary'} small" data-status="${r.status === '열림' ? '해결' : '열림'}">${r.status === '열림' ? '해결로 바꾸기' : '다시 열기'}</button>` : ''}
            ${r.author_id === me.user_id || isStaff ? html`<button type="button" class="link-button danger-text small" data-del-request>요청 지우기</button>` : ''}
          </div>
        </section>`)
        : html`<section class="card"><p class="muted">${filter === 'to' ? '우리 팀이 받은 요청이 없어요.' : '요청이 없어요.'}</p></section>`}
    </div>
  `);

  const redraw = () => requestsView(el, ctx, params);
  const form = el.querySelector('#rq-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#rq-msg');
    const btn = el.querySelector('#rq-btn');
    const v = (n) => form.elements[n].value.trim();
    const data = { to_team: v('to_team'), title: v('title'), body: v('body') };
    if (!data.to_team || !data.title || !data.body) return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    setBusy(btn, true, '올리는 중…');
    try {
      await rpc('save_team_request', { p_id: null, p_data: data });
      toast('요청을 올렸어요. 그 팀 알림에 떠요.');
      ctx.go('/requests?f=from');
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });

  const list = el.querySelector('#rq-list');
  list.addEventListener('submit', async (e) => {
    const f = e.target.closest('.reply-form');
    if (!f) return;
    e.preventDefault();
    const body = f.elements.body.value.trim();
    if (!body) return toast('답변 내용을 써 주세요.');
    try {
      await rpc('add_request_reply', { p_request: Number(f.closest('.request').dataset.id), p_body: body });
      toast('답변을 남겼어요.');
      redraw();
    } catch (err) {
      toast(err.message);
    }
  });
  list.addEventListener('click', async (e) => {
    const card = e.target.closest('.request');
    if (!card) return;
    const id = Number(card.dataset.id);
    try {
      const st = e.target.closest('[data-status]');
      const delReply = e.target.closest('[data-del-reply]');
      if (st) {
        await rpc('set_request_status', { p_id: id, p_status: st.dataset.status });
        toast(st.dataset.status === '해결' ? '해결로 바꿨어요.' : '다시 열었어요.');
      } else if (delReply) {
        if (!window.confirm('이 답변을 지울까요?')) return;
        await rpc('delete_request_reply', { p_id: Number(delReply.dataset.delReply) });
      } else if (e.target.closest('[data-del-request]')) {
        if (!window.confirm('이 요청을 지울까요? 답변도 함께 지워져요.')) return;
        await rpc('delete_team_request', { p_id: id });
      } else {
        return;
      }
      redraw();
    } catch (err) {
      toast(err.message);
    }
  });
}
