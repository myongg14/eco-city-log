import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchPurchases, fetchBudget, budgetSummary, fetchPeople, personName, formatDate, won } from '../records.js';

const STATUS_CLASS = { 신청: 'warn', 승인: 'ok', 반려: 'danger', '구매 완료': 'info', 수령: 'ok' };

export function budgetCard(b, { canEdit = false } = {}) {
  const pct = (n) => Math.max(0, Math.min(100, Math.round((n / (b.total || 1)) * 100)));
  return html`
    <div class="budget">
      <div class="budget-bar" role="img" aria-label="예산 ${pct(b.spent)}% 사용">
        <span class="spent" style="width:${pct(b.spent)}%"></span>
        <span class="pending" style="width:${pct(Math.min(b.pending, Math.max(b.left, 0)))}%"></span>
      </div>
      <div class="stats four">
        <div class="stat"><span class="stat-label">총예산</span><strong class="stat-value small">${won(b.total)}</strong></div>
        <div class="stat"><span class="stat-label">쓴 금액 (승인 이후)</span><strong class="stat-value small">${won(b.spent)}</strong></div>
        <div class="stat"><span class="stat-label">승인 대기</span><strong class="stat-value small">${won(b.pending)}</strong></div>
        <div class="stat ${b.left < 0 ? 'over' : ''}"><span class="stat-label">남은 금액</span><strong class="stat-value small">${won(b.left)}</strong></div>
      </div>
      ${b.afterPending < 0 ? html`<p class="message error">대기 중인 신청을 모두 승인하면 예산을 ${won(-b.afterPending)} 넘어요.</p>` : ''}
      ${canEdit ? html`
        <details class="field"><summary>총예산 바꾸기</summary>
          <form id="budget-form" class="inline-form" novalidate>
            <div><label for="budget-total">총예산(원)</label><input id="budget-total" type="number" inputmode="numeric" min="0" value="${b.total}"></div>
            <button type="submit" class="primary">저장</button>
          </form>
        </details>` : ''}
    </div>`;
}

function purchaseCard(p, { people, teams, me }) {
  const team = teams.find((t) => t.id === p.team_id);
  const mine = p.requester_id === me.user_id;
  const isTeacher = me.role === 'teacher';
  const isStaff = me.role !== 'student';
  return html`
    <article class="rec purchase" data-id="${p.id}">
      <div class="rec-head">
        <span class="badge ${STATUS_CLASS[p.status]}">${p.status}</span>
        <span class="rec-date">${formatDate(p.created_at)}</span>
      </div>
      <h3 class="rec-title">${p.item_name}</h3>
      <p class="price">${p.quantity}개 × ${won(p.unit_price)} = <strong>${won(p.total_price)}</strong></p>
      <p class="muted small">${personName(people, p.requester_id)}${team ? ` · ${team.name}` : ''} · 사용처: ${p.usage}
        ${p.shop_url ? html` · <a href="${p.shop_url}" target="_blank" rel="noopener noreferrer">구매처</a>` : ''}</p>
      <p class="small">필요한 이유: ${p.reason}</p>
      ${p.decided_by ? html`<p class="muted small">${p.status === '반려' ? '반려' : '승인'}: ${personName(people, p.decided_by)} · ${formatDate(p.decided_at)}</p>` : ''}
      ${p.reject_reason ? html`<p class="message error">반려 사유: ${p.reject_reason}</p>` : ''}
      <div class="row-actions">
        ${mine && ['신청', '반려'].includes(p.status) ? html`
          <a class="secondary" href="#/supplies/${p.id}">${p.status === '반려' ? '고쳐서 다시 신청' : '고치기'}</a>
          <button type="button" class="danger" data-act="delete">지우기</button>` : ''}
        ${isTeacher && p.status === '신청' ? html`
          <button type="button" class="primary small-btn" data-act="approve">승인</button>
          <button type="button" class="danger" data-act="reject-open">반려</button>` : ''}
        ${isStaff && p.status === '승인' ? html`<button type="button" class="secondary" data-act="stage" data-stage="구매 완료">구매 완료로</button>` : ''}
        ${isStaff && p.status === '구매 완료' ? html`
          <button type="button" class="secondary" data-act="stage" data-stage="수령">수령 완료로</button>
          <button type="button" class="link-button" data-act="stage" data-stage="승인">되돌리기</button>` : ''}
        ${isStaff && p.status === '수령' ? html`<button type="button" class="link-button" data-act="stage" data-stage="구매 완료">되돌리기</button>` : ''}
      </div>
      ${isTeacher && p.status === '신청' ? html`
        <form class="reject-form" hidden novalidate>
          <label>반려 사유 <span class="req">*</span></label>
          <input name="reason" placeholder="예: 과학실에 같은 부품이 있어요">
          <div class="row-actions"><button type="submit" class="danger">반려하기</button><button type="button" class="link-button" data-act="reject-close">취소</button></div>
        </form>` : ''}
    </article>`;
}

export async function suppliesView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let purchases, total, people;
  try {
    [purchases, total, people] = await Promise.all([fetchPurchases(), fetchBudget(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const isTeacher = me.role === 'teacher';
  const canRequest = me.role !== 'admin';
  const tab = params.get('t') || (isTeacher && purchases.some((p) => p.status === '신청') ? 'wait' : 'all');
  const lists = {
    all: purchases,
    wait: purchases.filter((p) => p.status === '신청'),
    buy: purchases.filter((p) => ['승인', '구매 완료'].includes(p.status)),
    have: purchases.filter((p) => p.status === '수령'),
    mine: purchases.filter((p) => p.requester_id === me.user_id),
  };
  const tabs = [
    ['all', '전체'],
    ['wait', isTeacher ? `승인함 (${lists.wait.length})` : `승인 대기 (${lists.wait.length})`],
    ['buy', '구매할 것'],
    ['have', '보유 물품'],
    ...(canRequest ? [['mine', '내 신청']] : []),
  ];
  const b = budgetSummary(total, purchases);
  const cardCtx = { people, teams, me };

  render(el, html`
    <section class="card">
      <div class="title-row">
        <h1 class="title">물품 신청</h1>
        ${canRequest ? html`<a class="primary button-link" href="#/supplies/new">+ 물품 신청</a>` : ''}
      </div>
      <p class="muted">학교 예산이에요. 모든 신청은 선생님이 최종 승인해요.${me.role === 'admin' ? ' 관리자는 승인된 물품의 구매·수령 상태를 기록해요.' : ''}</p>
      ${budgetCard(b, { canEdit: me.role !== 'student' })}
    </section>
    <section class="card">
      <div class="tabs scroll">
        ${tabs.map(([k, label]) => html`<a href="#/supplies?t=${k}" class="${tab === k ? 'active' : ''}">${label}</a>`)}
      </div>
      ${tab === 'have' ? html`<p class="hint">받은 물품이에요. 같은 물품을 또 신청하기 전에 먼저 확인해요.</p>` : ''}
      <div class="timeline" id="pr-list">
        ${lists[tab].length ? lists[tab].map((p) => purchaseCard(p, cardCtx)) : html`<p class="muted">없어요.</p>`}
      </div>
    </section>
  `);

  el.querySelector('#budget-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await rpc('set_total_budget', { p_amount: Number(el.querySelector('#budget-total').value) });
      toast('총예산을 바꿨어요.');
      suppliesView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });

  const listEl = el.querySelector('#pr-list');
  listEl.addEventListener('submit', async (e) => {
    const form = e.target.closest('.reject-form');
    if (!form) return;
    e.preventDefault();
    const id = Number(form.closest('.purchase').dataset.id);
    const reason = form.elements.reason.value.trim();
    if (!reason) return toast('반려 사유를 입력해 주세요.');
    try {
      await rpc('decide_purchase', { p_id: id, p_approve: false, p_reason: reason });
      toast('반려했어요.');
      suppliesView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.purchase');
    const id = Number(card.dataset.id);
    const act = btn.dataset.act;
    if (act === 'reject-open' || act === 'reject-close') {
      card.querySelector('.reject-form').hidden = act === 'reject-close';
      if (act === 'reject-open') card.querySelector('.reject-form input').focus();
      return;
    }
    if (act === 'delete' && !window.confirm('이 신청을 지울까요?')) return;
    if (act === 'approve') {
      const p = purchases.find((x) => x.id === id);
      if (p.total_price > b.left && !window.confirm(`남은 예산(${won(b.left)})보다 큰 신청이에요. 그래도 승인할까요?`)) return;
    }
    btn.disabled = true;
    try {
      if (act === 'delete') await rpc('delete_purchase', { p_id: id });
      if (act === 'approve') await rpc('decide_purchase', { p_id: id, p_approve: true, p_reason: null });
      if (act === 'stage') await rpc('set_purchase_stage', { p_id: id, p_stage: btn.dataset.stage });
      toast({ delete: '지웠어요.', approve: '승인했어요.', stage: `${btn.dataset.stage} 상태로 바꿨어요.` }[act]);
      suppliesView(el, ctx, params);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}

export async function purchaseFormView(el, ctx, id) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  if (me.role === 'admin') {
    render(el, html`<section class="card"><p class="message error">관리자 계정은 물품을 신청하지 않아요. 신청은 학생과 선생님이 해요.</p></section>`);
    return;
  }
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let purchases, total;
  try {
    [purchases, total] = await Promise.all([fetchPurchases(), fetchBudget()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const p = id ? purchases.find((x) => x.id === Number(id)) : {};
  if (id && (!p || p.requester_id !== me.user_id || !['신청', '반려'].includes(p.status))) {
    render(el, html`<section class="card"><p class="message error">내가 신청한 것 중 승인 전이거나 반려된 것만 고칠 수 있어요.</p></section>`);
    return;
  }
  const b = budgetSummary(total, purchases.filter((x) => x.id !== p.id));

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${id ? '물품 신청 고치기' : '물품 신청'}</h1>
      <p class="muted">남은 예산 ${won(b.left)} · 승인 대기 ${won(b.pending)}</p>
      ${p.reject_reason ? html`<p class="message error">반려 사유: ${p.reject_reason}</p>` : ''}
      <form id="pr-form" novalidate>
        <label for="pr-name">물품명·규격 <span class="req">*</span></label>
        <input id="pr-name" name="item_name" placeholder="예: 미니 태양광 패널 5V 1W" value="${p.item_name || ''}" autocomplete="off">
        <p class="hint vague" id="pr-dup" hidden></p>
        <div class="field-row">
          <div><label for="pr-qty">수량 <span class="req">*</span></label>
            <input id="pr-qty" name="quantity" type="number" inputmode="numeric" min="1" placeholder="4" value="${p.quantity || ''}"></div>
          <div><label for="pr-price">단가(원) <span class="req">*</span></label>
            <input id="pr-price" name="unit_price" type="number" inputmode="numeric" min="0" placeholder="2500" value="${p.unit_price ?? ''}"></div>
          <div><label>합계</label><p class="total-box" id="pr-total">0원</p></div>
        </div>
        <p class="message error" id="pr-over" hidden></p>
        <label for="pr-url">구매처 링크</label>
        <input id="pr-url" name="shop_url" type="url" placeholder="https://" value="${p.shop_url || ''}">
        <label for="pr-usage">사용처 (어느 기능) <span class="req">*</span></label>
        <input id="pr-usage" name="usage" list="pr-usage-list" placeholder="예: 태양광 가로등" value="${p.usage || ''}">
        <datalist id="pr-usage-list">${teams.map((t) => html`<option value="${t.name}">`)}</datalist>
        <label for="pr-reason">필요한 이유 <span class="req">*</span></label>
        <textarea id="pr-reason" name="reason" rows="3" placeholder="예: 가로등 4개에 각각 전원 공급">${p.reason || ''}</textarea>
        <p class="message" id="pr-msg" hidden></p>
        <button type="submit" class="primary" id="pr-btn">${p.status === '반려' ? '다시 신청' : id ? '고친 내용 저장' : '신청하기'}</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#pr-form');
  const totalEl = el.querySelector('#pr-total');
  const overEl = el.querySelector('#pr-over');
  const dupEl = el.querySelector('#pr-dup');
  const msg = el.querySelector('#pr-msg');
  const btn = el.querySelector('#pr-btn');

  function update() {
    const t = (Number(form.elements.quantity.value) || 0) * (Number(form.elements.unit_price.value) || 0);
    totalEl.textContent = won(t);
    overEl.hidden = t <= b.left;
    overEl.textContent = t > b.left ? `남은 예산(${won(b.left)})보다 ${won(t - b.left)} 많아요. 선생님이 승인하지 않을 수 있어요.` : '';
    const name = form.elements.item_name.value.trim().toLowerCase();
    const words = name.split(/\s+/).filter((w) => w.length >= 2);
    const similar = name.length >= 2 ? purchases.filter((x) => x.id !== p.id && x.status !== '반려'
      && words.some((w) => x.item_name.toLowerCase().includes(w))) : [];
    dupEl.hidden = !similar.length;
    dupEl.textContent = similar.length
      ? `비슷한 물품이 이미 있어요: ${similar.slice(0, 3).map((x) => `${x.item_name}(${x.status === '수령' ? '보유 중' : x.status})`).join(', ')}`
      : '';
  }
  form.addEventListener('input', update);
  update();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const v = (n) => form.elements[n].value.trim();
    const data = { item_name: v('item_name'), quantity: v('quantity'), unit_price: v('unit_price'), shop_url: v('shop_url'), usage: v('usage'), reason: v('reason') };
    if (!data.item_name || !data.quantity || data.unit_price === '' || !data.usage || !data.reason) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    if (data.shop_url && !/^https?:\/\//i.test(data.shop_url)) return showMessage(msg, '링크는 http:// 또는 https:// 로 시작해야 해요.');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_purchase', { p_id: id ? Number(id) : null, p_data: data });
      toast(id ? '신청을 고쳤어요.' : '신청했어요. 선생님 승인을 기다려요.');
      ctx.go('/supplies?t=mine');
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
}
