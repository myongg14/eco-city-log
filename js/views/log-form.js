import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchLogs, fetchParticipants, fetchPeople, ACTIVITY_TYPES, AREAS, splitLines, todayKst } from '../records.js';
import { field, selectField, checkGroup, checkedValues, bindVagueHints } from '../form.js';

// id 가 없으면 새로 쓰기
export async function logFormView(el, ctx, id) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let log = {};
  let joined = [];
  let people;
  let teams;
  try {
    people = await fetchPeople();
    teams = ctx.state.teams || [];
    if (id) {
      [log] = await fetchLogs({ id });
      if (!log || log.author_id !== me.user_id) {
        render(el, html`<section class="card"><p class="message error">내가 쓴 일지만 고칠 수 있어요.</p></section>`);
        return;
      }
      joined = (await fetchParticipants([log.id])).get(log.id) || [];
    }
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const students = [...people.values()].filter((p) => p.role === 'student' && p.user_id !== me.user_id);
  const option = (p) => ({ value: p.user_id, label: p.display_name ? `${p.display_name} (${p.login_id})` : p.login_id });
  const myTeam = students.filter((p) => p.team_id === me.team_id);
  const others = students.filter((p) => p.team_id !== me.team_id);
  const otherChosen = others.some((p) => joined.includes(p.user_id));

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${id ? '활동 일지 고치기' : '활동 일지'}</h1>
      <p class="muted">활동한 날마다 써요. 무엇을, 어떻게, 몇 번 했는지 숫자로 남기면 좋아요.</p>
      <form id="log-form" novalidate>
        <div class="field-row">
          ${field({ name: 'log_date', label: '날짜', required: true, type: 'date', value: log.log_date || todayKst(), attrs: `max="${todayKst()}"` })}
          ${field({ name: 'minutes', label: '활동 시간(분)', required: true, type: 'number', placeholder: '50', value: log.minutes, attrs: 'inputmode="numeric" min="1" max="1440"' })}
          ${selectField({ name: 'activity_type', label: '활동 유형', required: true, options: ACTIVITY_TYPES, value: log.activity_type })}
        </div>
        ${field({ name: 'did', label: '한 일', required: true, type: 'textarea', rows: 5,
          placeholder: '예: 아두이노에 수위 센서를 연결하고 물 높이 5cm, 10cm, 15cm에서 값을 읽음', value: log.did })}
        ${field({ name: 'problem', label: '문제와 해결', type: 'textarea', rows: 4,
          placeholder: '예: 센서 값이 튀어서 10번 읽은 평균값으로 보정함', value: log.problem })}
        ${field({ name: 'results', label: '실험 결과·측정값', type: 'textarea', rows: 3,
          placeholder: '예: 3회 측정 평균 12cm (11.8 / 12.1 / 12.0)', value: log.results })}
        ${checkGroup({ name: 'participants', label: '같이 한 우리 팀원', options: myTeam.map(option), values: joined,
          hint: myTeam.length ? '' : '우리 팀에 다른 팀원이 없어요.' })}
        ${others.length ? html`
          <details class="field" ${otherChosen ? 'open' : ''}>
            <summary>다른 팀 학생도 같이 했어요</summary>
            ${teams.filter((t) => others.some((p) => p.team_id === t.id)).map((t) => checkGroup({
              name: 'participants', label: t.name, options: others.filter((p) => p.team_id === t.id).map(option), values: joined,
            }))}
          </details>` : ''}
        ${field({ name: 'next_steps', label: '다음 할 일', type: 'textarea', rows: 2,
          placeholder: '펌프 연결\n방수 처리', hint: '한 줄에 하나씩 써요.', value: (log.next_steps || []).join('\n') })}
        ${checkGroup({ name: 'areas', label: '생기부 영역 (고르지 않아도 돼요)', options: AREAS, values: log.areas })}
        <p class="hint">사진 올리기는 다음 단계(사진 갤러리)에서 열려요.</p>
        <p class="message" id="log-msg" hidden></p>
        <button type="submit" class="primary" id="log-btn">저장</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#log-form');
  const msg = el.querySelector('#log-msg');
  const btn = el.querySelector('#log-btn');
  bindVagueHints(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const v = (n) => form.elements[n].value.trim();
    const data = {
      log_date: v('log_date'),
      minutes: v('minutes'),
      activity_type: v('activity_type'),
      did: v('did'),
      problem: v('problem'),
      results: v('results'),
      next_steps: splitLines(form.elements.next_steps.value),
      areas: checkedValues(form, 'areas'),
      participants: [...new Set(checkedValues(form, 'participants'))],
    };
    if (!data.log_date || !data.minutes || !data.activity_type || !data.did) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    const minutes = Number(data.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return showMessage(msg, '활동 시간은 1~1440분으로 입력해 주세요.');
    }

    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_log', { p_id: id ? Number(id) : null, p_data: data });
      toast(id ? '일지를 고쳤어요.' : '일지를 저장했어요.');
      ctx.go('/records');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
