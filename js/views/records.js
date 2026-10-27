import { rpc } from '../api.js';
import { html, render, toast, formatDateTime } from '../ui.js';
import { fetchPeople, fetchPlan, fetchResearch, fetchLogs, fetchJoinedLogs, fetchParticipants, fetchPhotos, fetchReflections, fetchComments, fetchPeerFeedback, fetchMeasurements, personName, kstDay } from '../records.js';
import { measureCard } from './measure.js';
import { bindCharts } from '../chart.js';
import { signedUrls, deletePhoto } from '../photos.js';
import { researchCard, logCard, planCard, reflectionCard } from './cards.js';
import { bindComments } from './comments.js';

// 내 기록 (?u=아이디 로 다른 사람 기록도 볼 수 있어요. 읽기만)
export async function recordsView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let people, target, plan, research, logs, joined, participants, photos, urls, reflections, comments, peer, measures;
  try {
    people = await fetchPeople();
    const wanted = params.get('u');
    target = wanted ? [...people.values()].find((p) => p.login_id === wanted) : people.get(me.user_id);
    if (!target) {
      render(el, html`<section class="card"><p class="message error">그 아이디의 기록을 찾을 수 없어요.</p></section>`);
      return;
    }
    if (target.role !== 'student' && target.user_id === me.user_id) {
      // 관리자·선생님은 자기 기록이 없으니 첫 학생을 보여 줘요.
      target = [...people.values()].find((p) => p.role === 'student') || target;
    }
    [plan, research, logs, joined, reflections] = await Promise.all([
      fetchPlan(target.user_id),
      fetchResearch({ authorId: target.user_id }),
      fetchLogs({ authorId: target.user_id }),
      fetchJoinedLogs(target.user_id),
      fetchReflections({ authorId: target.user_id }),
    ]);
    [peer, measures] = await Promise.all([fetchPeerFeedback({ toId: target.user_id }), fetchMeasurements({ authorId: target.user_id })]);
    joined = joined.filter((l) => l.author_id !== target.user_id);
    const logIds = [...logs, ...joined].map((l) => l.id);
    [participants, photos] = await Promise.all([fetchParticipants(logIds), fetchPhotos({ logIds })]);
    urls = await signedUrls([...photos.values()].flat()).catch(() => new Map());
    // 댓글은 기록을 쓴 학생과 관리자·선생님만 봐요.
    if (me.role !== 'student' || target.user_id === me.user_id) {
      comments = await fetchComments([
        { kind: 'log', ids: logs.map((l) => l.id) },
        { kind: 'research', ids: research.map((r) => r.id) },
        { kind: 'reflection', ids: reflections.map((r) => r.id) },
      ]);
    }
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const isMine = target.user_id === me.user_id;
  const isStaff = me.role !== 'student';
  const students = [...people.values()].filter((p) => p.role === 'student');
  const filter = params.get('f') || 'all';

  // 날짜(일지는 활동한 날, 조사는 쓴 날) → 쓴 시각 순서로 최신이 위로
  const key = (day, createdAt) => `${day}|${new Date(createdAt).toISOString()}`;
  const items = [
    ...research.map((r) => ({ kind: 'research', sort: key(kstDay(r.created_at), r.created_at), r })),
    ...logs.map((l) => ({ kind: 'log', sort: key(l.log_date, l.created_at), r: l })),
    ...joined.map((l) => ({ kind: 'joined', sort: key(l.log_date, l.created_at), r: l })),
    ...reflections.map((r) => ({ kind: 'reflection', sort: key(kstDay(r.created_at), r.created_at), r })),
    ...measures.map((m) => ({ kind: 'measure', sort: key(m.measured_on, m.created_at), r: m })),
  ]
    .filter((i) => filter === 'all' || i.kind === filter || (filter === 'log' && i.kind === 'joined'))
    .sort((a, b) => (a.sort < b.sort ? 1 : -1));

  const bySource = research.reduce((m, r) => m.set(r.source_type, (m.get(r.source_type) || 0) + 1), new Map());
  const cardCtx = { people, teams, meId: me.user_id, participants, photos, urls, comments, staff: isStaff };
  const showReflections = isMine || isStaff;

  // 팀원 상호 피드백: 받은 사람, 쓴 사람, 관리자·선생님만 봐요.
  function peerSection() {
    if (target.role !== 'student') return '';
    const canWrite = !isStaff && !isMine;
    if (!peer.length && !canWrite) {
      return isMine ? html`<section class="card"><h2 class="subtitle">친구들이 남긴 칭찬·조언</h2>
        <p class="muted">같이 활동한 친구가 칭찬이나 조언을 남기면 여기에 모여요.</p></section>` : '';
    }
    return html`
      <section class="card">
        <h2 class="subtitle">${isMine || isStaff ? '친구들이 남긴 칭찬·조언' : `${target.display_name || target.login_id}에게 칭찬·조언`}</h2>
        ${canWrite ? html`
          <p class="muted small">같이 활동한 뒤 기여한 점을 한 줄로 남겨요. 받은 친구와 선생님만 볼 수 있어요.</p>
          <form id="peer-form" class="peer-form">
            <select name="kind" aria-label="종류"><option>칭찬</option><option>조언</option></select>
            <input name="body" maxlength="300" placeholder="예: 배선을 색깔별로 정리해서 고장 찾기가 쉬웠어">
            <button type="submit" class="secondary small">남기기</button>
          </form>` : ''}
        <ul class="recent" id="peer-list">
          ${peer.map((f) => html`<li>
            <span class="badge ${f.kind === '칭찬' ? 'ok' : ''}">${f.kind}</span>
            <span class="recent-text">${f.body}</span>
            <span class="muted small">${personName(people, f.from_id)} · ${formatDateTime(f.created_at)}
              ${f.from_id === me.user_id ? html` <button type="button" class="link-button small" data-del-peer="${f.id}">지우기</button>` : ''}</span>
          </li>`)}
        </ul>
      </section>`;
  }
  const link = (f) => `#/records?${new URLSearchParams({ ...(params.get('u') ? { u: params.get('u') } : {}), f })}`;

  render(el, html`
    <section class="card">
      <div class="title-row">
        <h1 class="title">${isMine ? '내 기록' : `${personName(people, target.user_id)}의 기록`}</h1>
        ${isMine ? html`
          <div class="title-actions">
            <a class="secondary" href="#/log/new">+ 활동 일지</a>
            <a class="secondary" href="#/research/new">+ 이론 조사</a>
            <a class="secondary" href="#/reflection/new">+ 성찰</a>
          </div>` : ''}
      </div>
      <label for="who" class="inline-label">${isStaff ? '학생 고르기' : '다른 친구 기록 보기'}</label>
      <select id="who">
        ${isStaff ? '' : html`<option value="">나</option>`}
        ${teams.map((t) => {
          const members = students.filter((p) => p.team_id === t.id);
          if (!members.length) return '';
          return html`<optgroup label="${t.name}">
            ${members.map((p) => html`<option value="${p.login_id}" ${p.user_id === target.user_id && !(isMine && !isStaff) ? 'selected' : ''}>${p.display_name || '(이름 없음)'} · ${p.login_id}</option>`)}
          </optgroup>`;
        })}
      </select>
      <div class="stats">
        <div class="stat"><span class="stat-label">활동 일지</span><strong class="stat-value">${logs.length}</strong><span class="stat-label">같이 한 일지 ${joined.length}개</span></div>
        <div class="stat"><span class="stat-label">이론 조사</span><strong class="stat-value">${research.length}</strong>
          <span class="stat-label">${bySource.size ? [...bySource].map(([k, n]) => `${k} ${n}`).join(' · ') : '아직 없음'}</span></div>
        ${showReflections ? html`<div class="stat"><span class="stat-label">성찰</span><strong class="stat-value">${reflections.length}</strong>
          <span class="stat-label">${reflections.some((r) => r.kind === '최종') ? '최종 성찰 완료' : '매주 1번'}</span></div>` : ''}
      </div>
      ${isMine || isStaff ? html`<p class="hint"><a class="link" href="#/portfolio${isMine ? '' : `?u=${encodeURIComponent(target.login_id)}`}">📑 생기부 정리 보기</a></p>` : ''}
    </section>

    <section class="card">
      <div class="title-row">
        <h2 class="subtitle">개인 계획서</h2>
        ${isMine && plan ? html`<a class="secondary" href="#/plan">고치기</a>` : ''}
      </div>
      ${plan ? planCard(plan) : isMine
        ? html`<p class="muted">아직 계획서가 없어요. 동기, 탐구 질문, 목표를 먼저 정리해 두면 기록이 쉬워져요.</p>
               <a class="primary button-link" href="#/plan">계획서 쓰기</a>`
        : html`<p class="muted">아직 계획서를 쓰지 않았어요.</p>`}
    </section>

    ${peerSection()}

    <section class="card">
      <div class="tabs">
        ${[['all', '전체'], ['log', '활동 일지'], ['research', '이론 조사'], ['measure', '측정'], ...(showReflections ? [['reflection', '성찰']] : [])].map(([f, label]) =>
          html`<a href="${link(f)}" class="${filter === f ? 'active' : ''}">${label}</a>`)}
      </div>
      <div class="timeline" id="timeline">
        ${items.length ? items.map((i) => (i.kind === 'research'
          ? researchCard(i.r, { ...cardCtx, showAuthor: false })
          : i.kind === 'reflection' ? reflectionCard(i.r, cardCtx)
          : i.kind === 'measure' ? measureCard(i.r, { ...cardCtx, showAuthor: false })
          : logCard(i.r, { ...cardCtx, showAuthor: i.kind === 'joined', comments: i.kind === 'joined' ? null : comments })))
          : html`<p class="muted">${isMine ? '아직 기록이 없어요. 오늘 한 활동부터 일지로 남겨 보세요.' : '아직 기록이 없어요.'}</p>`}
      </div>
    </section>
  `);

  el.querySelector('#who').addEventListener('change', (e) => {
    ctx.go(e.target.value ? `/records?u=${encodeURIComponent(e.target.value)}` : '/records');
  });

  bindCharts(el);
  el.querySelector('#peer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = f.elements.body.value.trim();
    if (!body) return toast('한 줄을 써 주세요.');
    try {
      await rpc('add_peer_feedback', { p_to: target.user_id, p_kind: f.elements.kind.value, p_body: body, p_log: null });
      toast('남겼어요. 친구의 알림에 떠요.');
      recordsView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });
  el.querySelector('#peer-list')?.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-peer]');
    if (!del || !window.confirm('이 피드백을 지울까요?')) return;
    try {
      await rpc('delete_peer_feedback', { p_id: Number(del.dataset.delPeer) });
      recordsView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });

  const timeline = el.querySelector('#timeline');
  bindComments(timeline, () => recordsView(el, ctx, params));
  if (isMine && !isStaff) rpc('mark_comments_seen').catch(() => {});

  timeline.addEventListener('click', async (e) => {
    const delM = e.target.closest('[data-del-measure]');
    if (delM && window.confirm('이 측정 기록을 지울까요?')) {
      try {
        await rpc('delete_measurement', { p_id: Number(delM.dataset.delMeasure) });
        recordsView(el, ctx, params);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const btn = e.target.closest('button[data-del]');
    if (!btn) return;
    const kind = btn.dataset.del;
    const what = { log: '이 일지를', research: '이 조사 기록을', reflection: '이 성찰을' }[kind];
    if (!window.confirm(`${what} 지울까요? 되돌릴 수 없어요.`)) return;
    btn.disabled = true;
    try {
      if (kind === 'log') {
        // 사진 파일을 먼저 지워요. 일지를 지우면 사진 기록은 자동으로 지워지지만 파일은 남기 때문이에요.
        for (const ph of photos.get(Number(btn.dataset.id)) || []) await deletePhoto(ph.id);
      }
      await rpc(`delete_${kind}`, { p_id: Number(btn.dataset.id) });
      toast('지웠어요.');
      recordsView(el, ctx, params);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}
