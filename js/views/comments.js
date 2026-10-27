// 선생님 피드백 댓글 (일지, 성찰, 조사 카드 아래)
import { rpc } from '../api.js';
import { html, toast, formatDateTime } from '../ui.js';
import { personName } from '../records.js';

// comments 가 없으면(남의 기록을 보는 학생) 아무것도 그리지 않아요.
export function commentBlock(kind, record, { comments, people, meId, staff }) {
  if (!comments) return '';
  const list = comments.get(`${kind}:${record.id}`) || [];
  const canWrite = staff || record.author_id === meId;
  if (!list.length && !canWrite) return '';
  return html`
    <div class="comments">
      ${list.map((c) => {
        const who = people.get(c.author_id);
        const isStaffComment = who && who.role !== 'student';
        return html`
          <div class="comment ${isStaffComment ? 'from-staff' : ''}">
            <p class="comment-head">
              <strong>${isStaffComment ? `💬 ${who.role === 'teacher' ? '선생님' : '관리자'}` : personName(people, c.author_id)}</strong>
              <span class="muted small">${formatDateTime(c.created_at)}</span>
              ${c.author_id === meId ? html`<button type="button" class="link-button small" data-del-comment="${c.id}">지우기</button>` : ''}
            </p>
            <p class="pre">${c.body}</p>
          </div>`;
      })}
      ${canWrite ? html`
        <form class="comment-form" data-kind="${kind}" data-id="${record.id}">
          <textarea name="body" rows="2" maxlength="1000" placeholder="${staff ? '피드백 남기기' : '답글 남기기'}"></textarea>
          <button type="submit" class="secondary small">${staff ? '피드백 남기기' : '답글'}</button>
        </form>` : ''}
    </div>`;
}

// 목록 상자 하나에 한 번만 붙여요. 댓글을 쓰거나 지우면 onChange 로 화면을 다시 그려요.
export function bindComments(root, onChange) {
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form.comment-form');
    if (!form) return;
    e.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body) return toast('댓글 내용을 써 주세요.');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await rpc('add_comment', { p_kind: form.dataset.kind, p_id: Number(form.dataset.id), p_body: body });
      toast('댓글을 남겼어요.');
      onChange();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-comment]');
    if (!del || !window.confirm('이 댓글을 지울까요?')) return;
    del.disabled = true;
    try {
      await rpc('delete_comment', { p_id: Number(del.dataset.delComment) });
      onChange();
    } catch (err) {
      toast(err.message);
      del.disabled = false;
    }
  });
}
