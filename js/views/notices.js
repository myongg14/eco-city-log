import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchNotices, formatDate } from '../records.js';
import { field } from '../form.js';

// 홈 맨 위에 보이는 공지
export function noticeBoard(notices) {
  if (!notices.length) return '';
  return html`
    <section class="card notice-board">
      <h2 class="subtitle">📢 공지</h2>
      ${notices.map((n) => html`
        <details class="notice" ${n.pinned ? 'open' : ''}>
          <summary>${n.pinned ? html`<span class="badge danger">고정</span> ` : ''}${n.title}
            <span class="muted small">· ${formatDate(n.created_at)}</span></summary>
          ${n.body ? html`<p class="pre">${n.body}</p>` : ''}
        </details>`)}
    </section>`;
}

// 관리 화면의 공지 쓰기·고치기·지우기
export async function noticeAdmin(el) {
  let notices;
  try {
    notices = await fetchNotices();
  } catch (err) {
    render(el, html`<p class="message error">${err.message}</p>`);
    return;
  }
  let editing = null;

  function draw() {
    const n = notices.find((x) => x.id === editing) || {};
    render(el, html`
      <h2 class="subtitle">공지</h2>
      <form id="nt-form" novalidate>
        ${field({ name: 'title', label: editing ? '공지 고치기' : '새 공지 제목', required: true, placeholder: '예: 11/10(월) 7교시 전체 통합 테스트', value: n.title })}
        ${field({ name: 'body', label: '내용', type: 'textarea', rows: 3, value: n.body })}
        <label class="check plain"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}> 홈 맨 위에 고정</label>
        <p class="message" id="nt-msg" hidden></p>
        <div class="row-actions">
          <button type="submit" class="primary" id="nt-btn">${editing ? '고친 내용 저장' : '공지 올리기'}</button>
          ${editing ? html`<button type="button" class="secondary" id="nt-cancel">취소</button>` : ''}
        </div>
      </form>
      <ul class="notice-list">
        ${notices.map((x) => html`
          <li>
            <span>${x.pinned ? '📌 ' : ''}${x.title} <span class="muted small">${formatDate(x.created_at)}</span></span>
            <span class="row-actions">
              <button type="button" class="secondary" data-edit="${x.id}">고치기</button>
              <button type="button" class="danger" data-del="${x.id}">지우기</button>
            </span>
          </li>`)}
      </ul>
    `);

    const form = el.querySelector('#nt-form');
    const msg = el.querySelector('#nt-msg');
    const btn = el.querySelector('#nt-btn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showMessage(msg, '');
      if (!form.elements.title.value.trim()) return showMessage(msg, '공지 제목을 입력해 주세요.');
      setBusy(btn, true, '저장 중…');
      try {
        await rpc('save_notice', {
          p_id: editing,
          p_data: { title: form.elements.title.value, body: form.elements.body.value, pinned: form.elements.pinned.checked },
        });
        toast(editing ? '공지를 고쳤어요.' : '공지를 올렸어요.');
        editing = null;
        notices = await fetchNotices();
        draw();
      } catch (err) {
        showMessage(msg, err.message);
        setBusy(btn, false);
      }
    });
    el.querySelector('#nt-cancel')?.addEventListener('click', () => { editing = null; draw(); });
    el.querySelector('.notice-list').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (ed) { editing = Number(ed.dataset.edit); draw(); form.scrollIntoView({ behavior: 'smooth' }); }
      if (del && window.confirm('이 공지를 지울까요?')) {
        try {
          await rpc('delete_notice', { p_id: Number(del.dataset.del) });
          notices = await fetchNotices();
          toast('공지를 지웠어요.');
          draw();
        } catch (err) {
          toast(err.message);
        }
      }
    });
  }
  draw();
}
