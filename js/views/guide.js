import { html, render } from '../ui.js';
import { INITIAL_PASSWORD } from '../config.js';

const STEPS = [
  {
    icon: '🔑', title: '처음 로그인하기',
    body: [
      `아이디는 팀 번호와 내 번호예요. 예: 1팀의 1번은 team1-1`,
      `처음 비밀번호는 ${INITIAL_PASSWORD}이고, 로그인하면 바로 새 비밀번호(8자 이상)를 만들어야 해요.`,
      '이름, 맡은 역할, 희망 진로를 넣으면 시작돼요.',
    ],
  },
  {
    icon: '🔒', title: '비밀번호를 잊었을 때',
    body: [
      '5번 틀리면 10분 동안 잠겨요.',
      `관리자(최명간)나 선생님에게 말하면 비밀번호를 ${INITIAL_PASSWORD}로 초기화해 줘요.`,
      '비밀번호는 위쪽 메뉴의 ‘내 정보’에서 언제든 바꿀 수 있어요.',
    ],
  },
  {
    icon: '📝', title: '개인 계획서',
    body: [
      '‘내 기록’ → ‘계획서 쓰기’. 프로젝트를 시작할 때 한 번 써요.',
      '동기와 탐구 질문은 생기부 진로 영역의 근거가 돼요. 생각이 바뀌면 고쳐도 돼요.',
    ],
  },
  {
    icon: '📒', title: '활동 일지',
    body: [
      '활동한 날마다 화면 오른쪽 아래 ＋ 버튼 → ‘활동 일지’.',
      '같이 한 팀원을 체크하면 그 친구의 ‘내 기록’에도 보여요.',
      '“열심히”, “많이” 대신 “3번 측정해 평균 12cm”처럼 숫자와 행동으로 써요.',
    ],
  },
  {
    icon: '📚', title: '이론 조사',
    body: [
      '자료 한 건마다 ＋ 버튼 → ‘이론 조사’.',
      '출처(저자, 발행처, 링크 중 하나 이상)를 꼭 남기고, 요약은 내 말로 3~5문장 써요.',
      '모든 팀의 자료는 ‘자료실’에서 찾아볼 수 있어요.',
    ],
  },
  {
    icon: '👀', title: '누가 볼 수 있나요?',
    body: [
      '모든 기록은 로그인한 친구들과 선생님이 읽을 수 있어요.',
      '고치거나 지우는 건 쓴 사람만 할 수 있어요.',
      '생기부는 선생님이 관찰한 내용으로 작성해요. 이 사이트의 기록은 그 근거 자료예요.',
    ],
  },
];

export function guideView(el) {
  render(el, html`
    <section class="card">
      <h1 class="title">사용 안내</h1>
      <p class="muted">처음이라면 위에서부터 차례대로 읽어 보세요.</p>
    </section>
    <div class="guide">
      ${STEPS.map((s, i) => html`
        <section class="card guide-step">
          <h2 class="subtitle"><span class="guide-icon" aria-hidden="true">${s.icon}</span> ${i + 1}. ${s.title}</h2>
          <ul>${s.body.map((b) => html`<li>${b}</li>`)}</ul>
        </section>`)}
    </div>
  `);
}
