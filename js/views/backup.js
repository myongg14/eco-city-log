import { html, render, toast, setBusy } from '../ui.js';
import { fetchPlan, fetchResearch, fetchLogs, fetchJoinedLogs, fetchReflections, fetchPeople, personName, kstDay, weekLabel } from '../records.js';
import { toCsv, download, fetchAll } from '../export.js';
import { planCard, logCard, researchCard, reflectionCard } from './cards.js';

// 관리자·선생님 전체 백업에 넣는 표. 파일 이름은 휴대폰에서도 깨지지 않게 영어로 써요.
const TABLES = [
  ['teams', '팀'], ['profiles', '계정', 'user_id, login_id, display_name, role, team_id, role_desc, career_goal, last_login_at, created_at'],
  ['plans', '계획서'], ['activity_logs', '활동 일지'], ['log_participants', '같이 한 팀원'], ['research_notes', '이론 조사'],
  ['reflections', '성찰'], ['comments', '피드백 댓글'], ['tasks', '할 일'], ['purchase_requests', '물품 신청'],
  ['notices', '공지'], ['log_photos', '사진 목록'], ['app_settings', '설정'],
];

const LOG_COLS = [['log_date', '날짜'], ['minutes', '활동 시간(분)'], ['activity_type', '활동 유형'], ['did', '한 일'], ['problem', '문제와 해결'],
  ['results', '실험 결과·측정값'], ['next_steps', '다음 할 일'], ['areas', '생기부 영역'], ['subjects', '연계 교과'], ['created_at', '처음 쓴 시각'], ['updated_at', '고친 시각']];
const RESEARCH_COLS = [['title', '제목'], ['source_type', '출처 종류'], ['source_author', '저자'], ['source_publisher', '발행처'], ['source_year', '연도'],
  ['source_url', '링크'], ['summary', '핵심 내용 요약'], ['application', '모형에 적용할 점'], ['new_question', '새로 생긴 궁금증'], ['reliability', '신뢰도'],
  ['areas', '생기부 영역'], ['subjects', '연계 교과'], ['created_at', '처음 쓴 시각']];
const REFL_COLS = [[(r) => (r.kind === '최종' ? '최종 성찰' : weekLabel(r.week_of)), '주'], ['best', '가장 잘한 점'], ['hardship', '어려웠던 점과 극복'],
  ['learned', '새로 배운 것'], ['changed', '생각이 바뀐 점'], ['next_inquiry', '다음에 해 볼 탐구'], ['competencies', '스스로 느낀 역량'], ['created_at', '처음 쓴 시각']];

export async function backupView(el, ctx) {
  const me = ctx.state.me;
  const isStaff = me.role !== 'student';
  const day = kstDay();

  render(el, html`
    ${isStaff ? '' : html`
      <section class="card">
        <h1 class="title">내 기록 내려받기</h1>
        <p class="muted">엑셀 파일(CSV)은 엑셀이나 한셀, 구글 시트에서 열려요. PDF는 인쇄 화면에서 ‘PDF로 저장’을 고르면 돼요.</p>
        <div class="button-grid">
          <button type="button" class="secondary" data-mine="logs">📒 활동 일지 (엑셀)</button>
          <button type="button" class="secondary" data-mine="research">📚 이론 조사 (엑셀)</button>
          <button type="button" class="secondary" data-mine="reflections">🪞 성찰 (엑셀)</button>
          <button type="button" class="primary" id="bk-print">🖨 모든 기록 인쇄·PDF</button>
        </div>
      </section>`}
    ${isStaff ? html`
      <section class="card">
        <h1 class="title">전체 백업</h1>
        <p class="muted">모든 학생의 기록을 내려받아요. 한 달에 한 번, 그리고 프로젝트가 끝날 때 꼭 받아 두세요.
          사진 파일은 들어가지 않고 사진 목록(경로)만 들어가요.</p>
        <button type="button" class="primary" id="bk-json">💾 전체 백업 한 파일 (JSON)</button>
        <h2 class="subtitle">표마다 엑셀(CSV)로</h2>
        <div class="button-grid">
          ${TABLES.map(([t, label]) => html`<button type="button" class="secondary" data-table="${t}">${label}</button>`)}
        </div>
      </section>` : ''}
    <div id="bk-print-area" class="print-area" hidden></div>
  `);

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    try {
      if (btn.dataset.mine) {
        setBusy(btn, true, '만드는 중…');
        const kind = btn.dataset.mine;
        if (kind === 'logs') {
          const [mine, joined] = await Promise.all([fetchLogs({ authorId: me.user_id }), fetchJoinedLogs(me.user_id)]);
          const rows = [...mine.map((l) => ({ ...l, who: '내가 씀' })), ...joined.filter((l) => l.author_id !== me.user_id).map((l) => ({ ...l, who: '같이 함' }))];
          download(`eco-logs_${me.login_id}_${day}.csv`, toCsv(rows, [['who', '구분'], ...LOG_COLS]));
        } else if (kind === 'research') {
          download(`eco-research_${me.login_id}_${day}.csv`, toCsv(await fetchResearch({ authorId: me.user_id }), RESEARCH_COLS));
        } else {
          download(`eco-reflections_${me.login_id}_${day}.csv`, toCsv(await fetchReflections({ authorId: me.user_id }), REFL_COLS));
        }
      } else if (btn.id === 'bk-print') {
        setBusy(btn, true, '준비 중…');
        await printAll(el.querySelector('#bk-print-area'), ctx);
      } else if (btn.id === 'bk-json') {
        setBusy(btn, true, '모으는 중…');
        const backup = { made_at: new Date().toISOString(), made_by: me.login_id, tables: {} };
        for (const [t, , cols] of TABLES) backup.tables[t] = await fetchAll(t, cols);
        download(`eco-city-backup_${day}.json`, JSON.stringify(backup, null, 2), 'application/json');
      } else if (btn.dataset.table) {
        setBusy(btn, true, '만드는 중…');
        const [t, , cols] = TABLES.find(([name]) => name === btn.dataset.table);
        download(`eco-${t}_${day}.csv`, toCsv(await fetchAll(t, cols)));
      } else {
        return;
      }
      toast('내려받기를 시작했어요.');
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}

// 내 기록을 모두 펼친 인쇄용 화면을 만들고 인쇄 창을 열어요.
async function printAll(area, ctx) {
  const me = ctx.state.me;
  const [people, plan, logs, research, reflections] = await Promise.all([
    fetchPeople(), fetchPlan(me.user_id), fetchLogs({ authorId: me.user_id }), fetchResearch({ authorId: me.user_id }),
    fetchReflections({ authorId: me.user_id }),
  ]);
  const cardCtx = { people, teams: ctx.state.teams || [], meId: null, showAuthor: false };
  render(area, html`
    <section class="card">
      <h1 class="title">${personName(people, me.user_id)}의 기록</h1>
      <p class="muted">${ctx.state.team?.name || ''} · 출력한 날 ${kstDay()} · 에코시티 기록장</p>
    </section>
    <section class="card"><h2 class="subtitle">개인 계획서</h2>${plan ? planCard(plan) : html`<p class="muted">없음</p>`}</section>
    <section class="card"><h2 class="subtitle">활동 일지 ${logs.length}개</h2>${[...logs].reverse().map((l) => logCard(l, cardCtx))}</section>
    <section class="card"><h2 class="subtitle">이론 조사 ${research.length}개</h2>${[...research].reverse().map((r) => researchCard(r, cardCtx))}</section>
    <section class="card"><h2 class="subtitle">성찰 ${reflections.length}개</h2>${[...reflections].reverse().map((r) => reflectionCard(r, cardCtx))}</section>
  `);
  area.querySelectorAll('details').forEach((d) => { d.open = true; });
  area.hidden = false;
  document.body.classList.add('printing-area');
  const done = () => {
    document.body.classList.remove('printing-area');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
