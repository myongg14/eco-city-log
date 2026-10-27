import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { fetchRoles, fetchRoleHistory, fetchPeople, personName, ROLE_STATUSES, splitLines } from '../records.js';
import { field, selectField } from '../form.js';
import { dueLabel } from './tasks.js';

// 역할 표 (역할 분담 화면과 팀 페이지에서 같이 씀)
export function roleTable(roles, { people, isStaff = false }) {
  if (!roles.length) return html`<p class="muted">아직 정해진 역할이 없어요.</p>`;
  return html`
    <div class="table-wrap">
      <table class="table roles">
        <thead><tr><th>팀원</th><th>맡은 기능·분야</th><th>세부 담당 업무</th><th>기간·상태</th>${isStaff ? html`<th></th>` : ''}</tr></thead>
        <tbody>
          ${roles.map((r) => html`
            <tr data-id="${r.id}">
              <td>${personName(people, r.user_id)}</td>
              <td><strong>${r.area}</strong></td>
              <td><ul>${r.duties.map((d) => html`<li>${d}</li>`)}</ul></td>
              <td><span class="badge ${r.status === '완료' ? 'ok' : ''}">${r.status}</span> ${r.due_date ? dueLabel(r.due_date, r.status === '완료' ? '완료' : '') : ''}</td>
              ${isStaff ? html`<td class="nowrap">
                <a class="link-button small" href="#/roles?edit=${r.id}">고치기</a>
                <button type="button" class="link-button danger-text small" data-del-role="${r.id}">지우기</button></td>` : ''}
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

export function historyList(history, people, limit = 30) {
  if (!history.length) return html`<p class="muted">아직 바뀐 기록이 없어요.</p>`;
  return html`<ul class="recent">
    ${history.slice(0, limit).map((h) => html`
      <li>
        <span class="recent-text"><strong>${personName(people, h.user_id)}</strong> · ${h.change}${h.reason ? html`<br><span class="small">이유: ${h.reason}</span>` : ''}</span>
        <span class="muted small">${formatDateTime(h.changed_at)}${h.changed_by ? ` · ${people.get(h.changed_by)?.role === 'teacher' ? '선생님' : '관리자'}` : ''}</span>
      </li>`)}
  </ul>`;
}

export async function rolesView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let roles, history, people;
  try {
    [roles, history, people] = await Promise.all([fetchRoles(), fetchRoleHistory(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const students = [...people.values()].filter((p) => p.role === 'student');
  const editing = isStaff ? Number(params.get('edit')) || null : null;
  const r = roles.find((x) => x.id === editing) || {};
  const teamOf = (role) => people.get(role.user_id)?.team_id;
  const mine = roles.filter((x) => x.user_id === me.user_id);

  render(el, html`
    <section class="card">
      <h1 class="title">역할 분담</h1>
      <p class="muted">누가 어떤 기능을 맡았는지 한눈에 봐요. ${isStaff ? '역할을 바꾸면 바뀐 날짜와 이유가 이력에 남아요.' : '역할은 관리자와 선생님이 정해요.'}</p>
      ${mine.length ? html`<p>내 역할: ${mine.map((x) => html`<strong>${x.area}</strong> `)}</p>` : ''}
    </section>

    ${isStaff ? html`
      <section class="card">
        <details ${editing ? 'open' : ''}>
          <summary>${editing ? '역할 고치기' : '+ 역할 정하기'}</summary>
          <form id="role-form" novalidate>
            ${selectField({ name: 'user_id', label: '팀원', required: true, value: r.user_id,
              options: students.map((p) => ({ value: p.user_id, label: `${p.display_name || '(이름 없음)'} · ${p.login_id}` })) })}
            ${field({ name: 'area', label: '맡은 기능·분야', required: true, placeholder: '예: 에너지(태양광)', value: r.area })}
            ${field({ name: 'duties', label: '세부 담당 업무', required: true, type: 'textarea', rows: 3, placeholder: '패널 배치 설계\n배선',
              hint: '한 줄에 하나씩 써요.', value: (r.duties || []).join('\n') })}
            <div class="field-row">
              ${field({ name: 'due_date', label: '기간 (언제까지)', type: 'date', value: r.due_date })}
              ${selectField({ name: 'status', label: '상태', options: ROLE_STATUSES, value: r.status || '진행 중', empty: '진행 중' })}
            </div>
            ${field({ name: 'reason', label: editing ? '바꾼 이유 (담당자·분야·업무를 바꾸면 꼭)' : '메모 (고르지 않아도 돼요)',
              placeholder: editing ? '예: 배터리 팀 인원이 부족해서 옮김' : '예: 본인 희망', value: '' })}
            <p class="message" id="role-msg" hidden></p>
            <div class="row-actions">
              <button type="submit" class="primary" id="role-btn">${editing ? '고친 내용 저장' : '역할 저장'}</button>
              ${editing ? html`<a class="secondary" href="#/roles">취소</a>` : ''}
            </div>
          </form>
        </details>
      </section>` : ''}

    <div id="role-tables">
      ${teams.map((t) => {
        const list = roles.filter((x) => teamOf(x) === t.id);
        const members = students.filter((p) => p.team_id === t.id);
        if (!members.length) return '';
        const none = members.filter((p) => !list.some((x) => x.user_id === p.user_id));
        return html`
          <section class="card">
            <div class="title-row"><h2 class="subtitle">${t.name}</h2><a class="link small" href="#/team/${t.id}">팀 페이지</a></div>
            ${roleTable(list, { people, isStaff })}
            ${none.length ? html`<p class="hint">아직 역할이 없는 팀원: ${none.map((p) => p.display_name || p.login_id).join(', ')}</p>` : ''}
          </section>`;
      })}
    </div>

    <section class="card">
      <h2 class="subtitle">역할 변경 이력</h2>
      ${historyList(history, people)}
    </section>
  `);

  el.querySelector('#role-tables').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-role]');
    if (!del) return;
    const reason = window.prompt('이 역할을 끝내는 이유를 적어 주세요. (이력에 남아요)', '');
    if (reason === null) return;
    try {
      await rpc('delete_role', { p_id: Number(del.dataset.delRole), p_reason: reason });
      toast('역할을 지웠어요. 이력은 남아 있어요.');
      rolesView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });

  const form = el.querySelector('#role-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#role-msg');
    const btn = el.querySelector('#role-btn');
    const v = (n) => form.elements[n].value.trim();
    const data = { user_id: v('user_id'), area: v('area'), duties: splitLines(form.elements.duties.value), due_date: v('due_date'), status: v('status'), reason: v('reason') };
    if (!data.user_id || !data.area || !data.duties.length) return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    if (editing && !data.reason && (data.user_id !== r.user_id || data.area !== r.area || data.duties.join('\n') !== r.duties.join('\n'))) {
      return showMessage(msg, '역할이 바뀐 이유를 적어 주세요.');
    }
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_role', { p_id: editing, p_data: data });
      toast(editing ? '역할을 고쳤어요.' : '역할을 정했어요.');
      ctx.go('/roles');
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
}

