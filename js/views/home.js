import { html, render, formatDateTime } from '../ui.js';
import { PROJECT_DEADLINE } from '../config.js';
import { fetchPeople, fetchPlan, fetchResearch, fetchLogs, fetchNotices, fetchTasks, fetchPurchases, fetchBudget, budgetSummary, personName, formatDate, won } from '../records.js';
import { noticeBoard } from './notices.js';
import { taskCard } from './tasks.js';

// 다음 단계에 열릴 메뉴들. 열리면 이 목록에서 빼고 nav 에 넣습니다.
const UPCOMING = [
  { title: '성찰', desc: '매주 잘한 점, 어려웠던 점, 새로 배운 것을 돌아봐요.' },
  { title: '생기부 정리', desc: '내 기록을 자율·동아리·진로 영역별로 모아 초안을 만들어요.' },
  { title: '선생님 피드백·검색·백업', desc: '선생님 댓글, 모든 기록 한 번에 찾기, 내 기록 내려받기.' },
];

function daysLeft() {
  const end = new Date(`${PROJECT_DEADLINE}T23:59:59+09:00`);
  return Math.ceil((end - Date.now()) / 86400000);
}

export async function homeView(el, ctx) {
  const { me, team, teams, previousLoginAt } = ctx.state;
  const left = daysLeft();
  const isStudent = me.role === 'student';
  const roleLabel = me.role === 'admin' ? '관리자' : me.role === 'teacher' ? '선생님' : null;

  const draw = (extra, top = '') => render(el, html`
    ${top}
    <section class="card">
      <h1 class="title">${me.display_name}님, 안녕하세요</h1>
      <p class="muted">
        ${team ? html`${team.name} 팀` : roleLabel}
        · 아이디 ${me.login_id}
      </p>
      <div class="stats">
        <div class="stat">
          <span class="stat-label">마감까지</span>
          <strong class="stat-value">${left > 0 ? `D-${left}` : left === 0 ? 'D-DAY' : '마감 지남'}</strong>
          <span class="stat-label">${PROJECT_DEADLINE}</span>
        </div>
        <div class="stat">
          <span class="stat-label">지난 로그인</span>
          <strong class="stat-value small">${formatDateTime(previousLoginAt ?? me.last_login_at)}</strong>
        </div>
      </div>
      ${team?.topic ? html`<p class="hint">우리 팀 주제: ${team.topic}</p>` : ''}
    </section>
    ${extra || html`<section class="card"><p class="muted">기록을 불러오는 중…</p></section>`}
    <section class="card">
      <h2 class="subtitle">곧 열려요</h2>
      <ul class="upcoming">
        ${UPCOMING.map((m) => html`<li><strong>${m.title}</strong><span class="muted">${m.desc}</span></li>`)}
      </ul>
    </section>
  `);
  draw();

  try {
    const [notices, tasks, purchases, total, people, plan, myResearch, myLogs, recentResearch, recentLogs] = await Promise.all([
      fetchNotices({ limit: 5 }),
      fetchTasks(),
      fetchPurchases(),
      fetchBudget(),
      fetchPeople(),
      isStudent ? fetchPlan(me.user_id) : null,
      isStudent ? fetchResearch({ authorId: me.user_id }) : [],
      isStudent ? fetchLogs({ authorId: me.user_id }) : [],
      fetchResearch({ limit: 5 }),
      fetchLogs({ limit: 5 }),
    ]);
    const recent = [
      ...recentResearch.map((r) => ({ when: r.created_at, kind: '이론 조사', text: r.title, who: r.author_id, team: r.team_id })),
      ...recentLogs.map((l) => ({ when: l.created_at, kind: `일지 · ${l.activity_type}`, text: String(l.did).split('\n')[0], who: l.author_id, team: l.team_id })),
    ].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 5);

    // 이번 주 할 일: 내 것(학생) 또는 전체(관리자·선생님) 중 끝나지 않았고 7일 안에 마감이거나 지난 것
    const weekEnd = new Date(Date.now() + 7 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    const soon = tasks.filter((t) => t.status !== '완료' && (isStudent ? t.assignee_id === me.user_id : true)
      && (!t.due_date || t.due_date <= weekEnd))
      .sort((a, b) => (a.due_date || '9') < (b.due_date || '9') ? -1 : 1).slice(0, 6);
    const waiting = purchases.filter((p) => p.status === '신청');
    const b = budgetSummary(total, purchases);

    draw(html`
      <section class="card">
        <div class="title-row"><h2 class="subtitle">${isStudent ? '이번 주 내 할 일' : '이번 주 할 일'}</h2><a class="link small" href="#/tasks">할 일 보드</a></div>
        ${soon.length ? html`<div class="timeline">${soon.map((t) => taskCard(t, { people, teams, me, compact: true }))}</div>`
          : html`<p class="muted">${isStudent ? '이번 주에 마감인 내 할 일이 없어요.' : '이번 주 마감인 할 일이 없어요.'}</p>`}
      </section>
      <section class="card">
        <div class="title-row"><h2 class="subtitle">물품 · 예산</h2><a class="link small" href="#/supplies${waiting.length && me.role === 'teacher' ? '?t=wait' : ''}">물품 신청</a></div>
        <p>${me.role === 'teacher' && waiting.length ? html`<strong class="warn-text">승인 대기 ${waiting.length}건</strong> · ` : waiting.length ? `승인 대기 ${waiting.length}건 · ` : ''}남은 예산 <strong>${won(b.left)}</strong> / ${won(b.total)}</p>
      </section>
      ${isStudent ? html`
        <section class="card">
          <h2 class="subtitle">내 기록</h2>
          <div class="quick">
            <a class="quick-item ${plan ? 'done' : 'todo'}" href="#/${plan ? 'records' : 'plan'}">
              <strong>${plan ? '✓ 계획서' : '계획서 쓰기'}</strong>
              <span class="muted">${plan ? '작성 완료' : '먼저 써 주세요'}</span>
            </a>
            <a class="quick-item" href="#/log/new"><strong>📒 일지 ${myLogs.length}개</strong><span class="muted">＋ 오늘 활동 쓰기</span></a>
            <a class="quick-item" href="#/research/new"><strong>📚 조사 ${myResearch.length}개</strong><span class="muted">＋ 자료 기록하기</span></a>
          </div>
        </section>` : ''}
      <section class="card">
        <h2 class="subtitle">최근 기록</h2>
        ${recent.length ? html`
          <ul class="recent">
            ${recent.map((r) => html`
              <li>
                <span class="badge">${r.kind}</span>
                <span class="recent-text">${r.text.length > 50 ? `${r.text.slice(0, 50)}…` : r.text}</span>
                <span class="muted small">${personName(people, r.who)}${teams.find((t) => t.id === r.team)
                  ? ` · ${teams.find((t) => t.id === r.team).name}` : ''} · ${formatDate(r.when)}</span>
              </li>`)}
          </ul>
          <a class="link" href="#/${isStudent ? 'library' : 'records'}">더 보기</a>`
        : html`<p class="muted">아직 아무도 기록을 쓰지 않았어요. ${isStudent ? '첫 기록의 주인공이 되어 보세요!' : ''}</p>`}
      </section>
    `, noticeBoard(notices));
  } catch (err) {
    draw(html`<section class="card"><p class="message error">${err.message}</p></section>`);
  }
}
