import { html, render, formatDateTime } from '../ui.js';
import { PROJECT_DEADLINE } from '../config.js';

// 2단계 이후에 열릴 메뉴들. 열리면 이 목록에서 빼고 nav 에 넣습니다.
const UPCOMING = [
  { title: '개인 계획서', desc: '내가 맡은 일과 목표, 일정을 정리해요.' },
  { title: '이론 조사', desc: '조사한 내용과 출처를 함께 남겨요.' },
  { title: '활동 일지', desc: '그날 한 일, 사진, 문제와 해결 과정을 기록해요.' },
  { title: '물품 신청', desc: '필요한 물품을 신청하고 승인 상태를 확인해요.' },
  { title: '생기부 정리', desc: '내 기록을 자율·동아리·진로 영역별로 모아 봐요.' },
];

function daysLeft() {
  const end = new Date(`${PROJECT_DEADLINE}T23:59:59+09:00`);
  return Math.ceil((end - Date.now()) / 86400000);
}

export function homeView(el, ctx) {
  const { me, team, previousLoginAt } = ctx.state;
  const left = daysLeft();
  const roleLabel = me.role === 'admin' ? '관리자' : me.role === 'teacher' ? '선생님' : null;

  render(el, html`
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

    <section class="card">
      <h2 class="subtitle">곧 열려요</h2>
      <ul class="upcoming">
        ${UPCOMING.map((m) => html`<li><strong>${m.title}</strong><span class="muted">${m.desc}</span></li>`)}
      </ul>
    </section>
  `);
}
