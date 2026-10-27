import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchReflections, COMPETENCIES, weekMonday, weekLabel, addDays, todayKst } from '../records.js';
import { field, checkGroup, checkedValues, bindVagueHints } from '../form.js';

// id 가 없으면 새로 쓰기. ?kind=최종 이면 최종 성찰
export async function reflectionFormView(el, ctx, id, params) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let mine;
  try {
    mine = await fetchReflections({ authorId: me.user_id });
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  let r = {};
  if (id) {
    r = mine.find((x) => String(x.id) === String(id));
    if (!r) {
      render(el, html`<section class="card"><p class="message error">내가 쓴 성찰만 고칠 수 있어요.</p></section>`);
      return;
    }
  }
  const kind = r.kind || (params?.get('kind') === '최종' ? '최종' : '주간');
  const finalDone = mine.find((x) => x.kind === '최종');
  if (!id && kind === '최종' && finalDone) return ctx.go(`/reflection/${finalDone.id}`);

  // 고를 수 있는 주: 이번 주부터 8주 전까지 (이미 쓴 주는 빼요)
  const thisWeek = weekMonday(todayKst());
  const written = new Set(mine.filter((x) => x.kind === '주간' && x.id !== r.id).map((x) => x.week_of));
  const weeks = Array.from({ length: 9 }, (_, i) => addDays(thisWeek, -7 * i)).filter((w) => !written.has(w) || w === r.week_of);
  if (r.week_of && !weeks.includes(r.week_of)) weeks.push(r.week_of);
  const chosenWeek = r.week_of || weeks[0];

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${kind === '최종' ? '최종 성찰' : '주간 성찰'}${id ? ' 고치기' : ''}</h1>
      <p class="muted">${kind === '최종'
        ? '프로젝트를 마치며 처음과 지금을 비교해 봐요. 생기부 진로 영역의 중요한 근거가 돼요.'
        : '일주일에 한 번, 이번 주 활동을 돌아봐요. 친구들은 볼 수 없고 선생님·관리자만 읽어요.'}</p>
      <form id="rf-form" novalidate>
        ${kind === '주간' ? html`
          <div class="field">
            <label for="rf-week">성찰할 주 <span class="req">*</span></label>
            <select id="rf-week" name="week_of">
              ${weeks.length ? weeks.map((w) => html`<option value="${w}" ${w === chosenWeek ? 'selected' : ''}>${weekLabel(w)}${w === thisWeek ? ' (이번 주)' : ''}</option>`)
                : html`<option value="">최근 8주의 성찰을 모두 썼어요</option>`}
            </select>
          </div>` : ''}
        ${field({ name: 'best', label: kind === '최종' ? '프로젝트에서 가장 잘한 점' : '이번 주 가장 잘한 점', required: true,
          placeholder: '예: 센서 오류 원인을 스스로 찾음', value: r.best })}
        ${field({ name: 'hardship', label: '어려웠던 점과 극복', required: true, type: 'textarea', rows: 4,
          placeholder: '예: 배선 방식에서 팀원과 의견이 달라 두 방식을 3번씩 측정해 비교한 뒤 결정함', value: r.hardship })}
        ${field({ name: 'learned', label: '새로 배운 것', required: true, type: 'textarea', rows: 4,
          placeholder: '예: 전선이 길수록 전압 강하가 커져 LED 밝기가 줄어든다는 것', value: r.learned })}
        ${field({ name: 'changed', label: '생각이 바뀐 점', type: 'textarea', rows: 3,
          placeholder: '예: 친환경은 비용과 효율을 함께 봐야 한다는 것을 알게 됨', value: r.changed })}
        ${field({ name: 'next_inquiry', label: '다음에 해 볼 탐구', placeholder: '예: 실제 도시의 스마트그리드 운영 사례 조사', value: r.next_inquiry })}
        ${checkGroup({ name: 'competencies', label: '스스로 느낀 역량 (여러 개 골라도 돼요)', options: COMPETENCIES, values: r.competencies,
          hint: '고른 역량은 생기부 정리에서 그 주의 일지와 함께 근거로 묶여요.' })}
        <p class="message" id="rf-msg" hidden></p>
        <button type="submit" class="primary" id="rf-btn">저장</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#rf-form');
  const msg = el.querySelector('#rf-msg');
  const btn = el.querySelector('#rf-btn');
  bindVagueHints(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const v = (n) => (form.elements[n]?.value || '').trim();
    const data = {
      kind,
      week_of: v('week_of'),
      best: v('best'),
      hardship: v('hardship'),
      learned: v('learned'),
      changed: v('changed'),
      next_inquiry: v('next_inquiry'),
      competencies: checkedValues(form, 'competencies'),
    };
    if ((kind === '주간' && !data.week_of) || !data.best || !data.hardship || !data.learned) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_reflection', { p_id: id ? Number(id) : null, p_data: data });
      toast(id ? '성찰을 고쳤어요.' : '성찰을 저장했어요.');
      ctx.go('/records?f=reflection');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
