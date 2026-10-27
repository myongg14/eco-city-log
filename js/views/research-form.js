import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchResearch, SOURCE_TYPES, AREAS, SUBJECTS } from '../records.js';
import { field, selectField, checkGroup, checkedValues, bindVagueHints, saveSubjects } from '../form.js';

// id 가 없으면 새로 쓰기
export async function researchFormView(el, ctx, id) {
  let note = {};
  if (id) {
    render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
    try {
      [note] = await fetchResearch({ id });
    } catch (err) {
      render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
      return;
    }
    if (!note || note.author_id !== ctx.state.me.user_id) {
      render(el, html`<section class="card"><p class="message error">내가 쓴 조사 기록만 고칠 수 있어요.</p></section>`);
      return;
    }
  }

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${id ? '이론 조사 고치기' : '이론 조사 기록'}</h1>
      <p class="muted">자료 한 건마다 하나씩 써요. 출처가 있어야 생기부 근거로 쓸 수 있어요.</p>
      <form id="rs-form" novalidate>
        ${field({ name: 'title', label: '제목', required: true, placeholder: '예: 빗물 이용시설 설치 기준', value: note.title })}
        ${selectField({ name: 'source_type', label: '출처 종류', required: true, options: SOURCE_TYPES, value: note.source_type })}
        <div class="field-row">
          ${field({ name: 'source_author', label: '저자', placeholder: '예: 홍길동', value: note.source_author })}
          ${field({ name: 'source_publisher', label: '발행처', placeholder: '예: 환경부', value: note.source_publisher })}
          ${field({ name: 'source_year', label: '연도', type: 'number', placeholder: '2024', value: note.source_year, attrs: 'inputmode="numeric" min="1800" max="2100"' })}
        </div>
        ${field({ name: 'source_url', label: '링크', type: 'url', placeholder: 'https://', value: note.source_url,
          hint: '저자, 발행처, 링크 중 하나 이상은 꼭 써요.' })}
        ${field({ name: 'summary', label: '핵심 내용 요약', required: true, type: 'textarea', rows: 6,
          placeholder: '읽은 내용을 내 말로 3~5문장으로 정리해요.',
          hint: '복사·붙여넣기 말고 내 말로 써야 해요. 숫자와 기준값이 있으면 함께 적어요.', value: note.summary })}
        ${field({ name: 'application', label: '모형에 적용할 점', required: true, type: 'textarea', rows: 3,
          placeholder: '예: 저수조 용량을 계산할 때 강수량 기준으로 사용', value: note.application })}
        ${field({ name: 'new_question', label: '새로 생긴 궁금증', placeholder: '예: 자연 저수와 비교하면 효율이 어떨까?', value: note.new_question })}
        ${selectField({ name: 'reliability', label: '신뢰도 자기평가', value: note.reliability, empty: '고르지 않음',
          options: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n}점)` })),
          hint: '공공기관·논문은 높게, 개인 블로그는 낮게 줘요.' })}
        ${checkGroup({ name: 'areas', label: '생기부 영역 (고르지 않아도 돼요)', options: AREAS, values: note.areas })}
        ${checkGroup({ name: 'subjects', label: '연계 교과 (고르지 않아도 돼요)', options: SUBJECTS, values: note.subjects,
          hint: '이 활동에서 쓴 교과 지식을 고르면 생기부 정리에서 교과별로 모여요.' })}
        <p class="message" id="rs-msg" hidden></p>
        <button type="submit" class="primary" id="rs-btn">저장</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#rs-form');
  const msg = el.querySelector('#rs-msg');
  const btn = el.querySelector('#rs-btn');
  bindVagueHints(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const v = (n) => form.elements[n].value.trim();
    const data = {
      title: v('title'),
      source_type: v('source_type'),
      source_author: v('source_author'),
      source_publisher: v('source_publisher'),
      source_year: v('source_year'),
      source_url: v('source_url'),
      summary: v('summary'),
      application: v('application'),
      new_question: v('new_question'),
      reliability: v('reliability'),
      areas: checkedValues(form, 'areas'),
    };
    if (!data.title || !data.source_type || !data.summary || !data.application) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    if (!data.source_author && !data.source_publisher && !data.source_url) {
      return showMessage(msg, '출처 정보(저자, 발행처, 링크 중 하나 이상)를 입력해 주세요.');
    }
    if (data.source_url && !/^https?:\/\//i.test(data.source_url)) {
      return showMessage(msg, '링크는 http:// 또는 https:// 로 시작해야 해요.');
    }

    setBusy(btn, true, '저장 중…');
    try {
      const savedId = await rpc('save_research', { p_id: id ? Number(id) : null, p_data: data });
      await saveSubjects('research', savedId, checkedValues(form, 'subjects'), note.subjects);
      toast(id ? '조사 기록을 고쳤어요.' : '조사 기록을 저장했어요.');
      ctx.go('/records');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
