import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchPlan, splitLines, shortDate } from '../records.js';
import { field, bindVagueHints } from '../form.js';

// "1주차: 조사" 처럼 한 줄에 하나
function weeklyToText(weekly) {
  return (weekly || []).map((w) => (w.week ? `${w.week}: ${w.plan}` : w.plan)).join('\n');
}

function textToWeekly(text) {
  return splitLines(text).map((line) => {
    const m = line.match(/^([^:：]{1,20})[:：]\s*(.*)$/);
    return m ? { week: m[1].trim(), plan: m[2].trim() } : { week: '', plan: line };
  });
}

export async function planView(el, ctx) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let plan;
  try {
    plan = await fetchPlan(me.user_id);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const p = plan || {};

  render(el, html`
    <section class="card form-card">
      <h1 class="title">개인 계획서</h1>
      <p class="muted">프로젝트를 시작하며 한 번 쓰고, 바뀌면 언제든 고칠 수 있어요. 생기부의 '동기'와 '진로' 근거가 돼요.</p>
      <form id="plan-form" novalidate>
        ${field({ name: 'motivation', label: '동기', required: true, type: 'textarea',
          placeholder: '예: 기후 위기 기사를 보고 도시의 에너지 자립에 관심이 생김',
          hint: '언제, 무엇을 보고 관심이 생겼는지 구체적으로 써요.', value: p.motivation })}
        ${field({ name: 'role_focus', label: '내가 맡을 기능·역할', required: true,
          placeholder: '예: 빗물 저장·재활용 장치 설계', value: p.role_focus ?? me.role_desc })}
        ${field({ name: 'question', label: '탐구 질문', required: true,
          placeholder: '예: 빗물을 얼마나 모아야 가로수에 충분할까?', value: p.question })}
        ${field({ name: 'goals', label: '목표 (만들 것, 배울 것)', required: true, type: 'textarea', rows: 3,
          placeholder: '작동하는 저수조 모형 완성\n수위 센서 사용법 익히기',
          hint: '한 줄에 하나씩 써요.', value: (p.goals || []).join('\n') })}
        ${field({ name: 'theories', label: '조사할 이론', type: 'textarea', rows: 3,
          placeholder: '빗물 이용 시설 기준\n옴의 법칙', hint: '한 줄에 하나씩 써요.', value: (p.theories || []).join('\n') })}
        ${field({ name: 'subjects', label: '연계 교과·진로',
          placeholder: '예: 통합과학, 물리 / 환경공학 진로', value: p.subjects ?? me.career_goal })}
        ${field({ name: 'weekly', label: '주차별 계획', type: 'textarea', rows: 5,
          placeholder: '1주차: 자료 조사\n2~3주차: 저수조 제작\n4주차: 테스트',
          hint: '"1주차: 할 일" 처럼 한 줄에 한 주씩 써요.', value: weeklyToText(p.weekly) })}
        <p class="message" id="plan-msg" hidden></p>
        <button type="submit" class="primary" id="plan-btn">계획서 저장</button>
      </form>
      ${plan ? html`<p class="hint">처음 쓴 날 ${shortDate(plan.created_at)} · 마지막으로 고친 날 ${shortDate(plan.updated_at)}</p>` : ''}
    </section>
  `);

  const form = el.querySelector('#plan-form');
  const msg = el.querySelector('#plan-msg');
  const btn = el.querySelector('#plan-btn');
  bindVagueHints(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const data = {
      motivation: form.motivation.value,
      role_focus: form.role_focus.value,
      question: form.question.value,
      goals: splitLines(form.goals.value),
      theories: splitLines(form.theories.value),
      subjects: form.subjects.value,
      weekly: textToWeekly(form.weekly.value),
    };
    if (!data.motivation.trim() || !data.role_focus.trim() || !data.question.trim()) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    if (!data.goals.length) return showMessage(msg, '목표를 한 줄 이상 입력해 주세요.');

    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_plan', { p_data: data });
      toast('계획서를 저장했어요.');
      ctx.go('/records');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
