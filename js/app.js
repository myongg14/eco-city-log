import { sb, fetchMyProfile, fetchTeams } from './api.js';
import { html, render } from './ui.js';
import { loginView } from './views/login.js';
import { passwordView } from './views/password.js';
import { profileView } from './views/profile.js';
import { homeView } from './views/home.js';
import { meView } from './views/me.js';
import { adminView } from './views/admin.js';
import { recordsView } from './views/records.js';
import { planView } from './views/plan.js';
import { researchFormView } from './views/research-form.js';
import { logFormView } from './views/log-form.js';
import { libraryView } from './views/library.js';
import { guideView } from './views/guide.js';
import { tasksView } from './views/tasks.js';
import { suppliesView, purchaseFormView } from './views/supplies.js';
import { galleryView } from './views/gallery.js';
import { teamsView, teamView } from './views/teams.js';
import { reflectionFormView } from './views/reflection-form.js';
import { portfolioView } from './views/portfolio.js';
import { searchView } from './views/search.js';
import { backupView } from './views/backup.js';
import { scheduleView } from './views/schedule.js';
import { rolesView } from './views/roles.js';
import { alertsView } from './views/alerts.js';
import { progressView } from './views/progress.js';
import { measureView, measureFormView } from './views/measure.js';
import { requestsView } from './views/requests.js';
import { linksView } from './views/links.js';
import { presentView } from './views/present.js';
import { showcaseView, showcaseSettingsView } from './views/showcase.js';
import { fetchAlerts } from './records.js';

const state = {
  session: null,
  me: null,          // profiles 행
  team: null,        // 내 팀
  teams: [],         // 볼 수 있는 모든 팀
  previousLoginAt: null,
};

const unread = { at: 0, count: 0 };   // 새 알림 숫자 (1분 동안 기억)

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');
const fabEl = document.getElementById('fab');

export function go(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

export async function refreshMe() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (!state.session) {
    state.me = null;
    state.team = null;
    return;
  }
  state.me = await fetchMyProfile(state.session.user.id);
  if (!state.me) {
    // 예비 팀이 꺼져 있거나 계정이 지워진 경우
    await sb.auth.signOut();
    state.session = null;
    return;
  }
  state.teams = await fetchTeams();
  state.team = state.teams.find((t) => t.id === state.me.team_id) || null;
}

export async function logout() {
  unread.at = 0;
  await sb.auth.signOut();
  state.session = null;
  state.me = null;
  state.team = null;
  go('/login');
}

function clearAlertBadge() {
  unread.count = 0;
  unread.at = Date.now();
  navEl.querySelector('.nav-badge')?.remove();
}

const ctx = { state, go, refreshMe, logout, clearAlertBadge };

function isStaff() {
  return state.me && (state.me.role === 'admin' || state.me.role === 'teacher');
}

function renderNav(current) {
  const ready = state.me && !state.me.must_change_password && state.me.profile_completed;
  renderFab(ready && state.me.role === 'student');
  if (!ready) {
    navEl.hidden = true;
    navEl.innerHTML = '';
    return;
  }
  const links = [
    { path: '/home', label: '홈' },
    { path: '/alerts', label: '🔔 알림' },
    { path: '/records', label: isStaff() ? '학생 기록' : '내 기록', also: '/reflection/' },
    { path: '/portfolio', label: '생기부' },
    { path: '/teams', label: '팀', also: '/team/', also2: ['/roles', '/progress', '/requests', '/links', '/present'] },
    { path: '/schedule', label: '일정' },
    { path: '/tasks', label: '할 일' },
    { path: '/measure', label: '측정' },
    { path: '/supplies', label: '물품' },
    { path: '/gallery', label: '갤러리' },
    { path: '/library', label: '자료실' },
    { path: '/search', label: '검색' },
    { path: '/guide', label: '안내' },
    { path: '/me', label: '내 정보', also: '/backup' },
  ];
  if (isStaff()) links.push({ path: '/admin', label: '관리' });
  navEl.hidden = false;
  render(navEl, html`
    ${links.map((l) => html`<a href="#${l.path}" class="${current.startsWith(l.path) || (l.also && current.startsWith(l.also)) || (l.also2 && l.also2.some((p) => current.startsWith(p))) ? 'active' : ''}">${l.label}</a>`)}
    <button type="button" class="link-button" id="logout-btn">로그아웃</button>
  `);
  navEl.querySelector('#logout-btn').addEventListener('click', logout);
  showAlertBadge(current);
  // 휴대폰에서 메뉴가 옆으로 밀릴 때 지금 화면 메뉴가 보이게 가운데로 옮겨요.
  const active = navEl.querySelector('a.active');
  if (active && navEl.scrollWidth > navEl.clientWidth) {
    navEl.scrollLeft = active.offsetLeft - navEl.clientWidth / 2 + active.offsetWidth / 2;
  }
}

// 새 알림(피드백, 배정된 할 일, 물품 결과 등)이 있으면 '알림' 메뉴에 숫자를 붙여요. 1분에 한 번만 확인해요.
async function showAlertBadge(current) {
  if (current.startsWith('/alerts')) return;
  if (Date.now() - unread.at > 60000) {
    try {
      unread.count = (await fetchAlerts(state.me)).newCount;
      unread.at = Date.now();
    } catch {
      return;
    }
  }
  const link = navEl.querySelector('a[href="#/alerts"]');
  if (link && unread.count && !link.querySelector('.nav-badge')) {
    link.insertAdjacentHTML('beforeend', `<span class="nav-badge" aria-label="새 알림">${unread.count}</span>`);
  }
}

// 어느 화면에서나 누르는 기록하기(+) 버튼. 학생만 보여요.
function renderFab(show) {
  if (!show) {
    fabEl.hidden = true;
    fabEl.innerHTML = '';
    return;
  }
  if (!fabEl.hidden && fabEl.innerHTML) {
    fabEl.querySelector('.fab-menu').hidden = true;
    return;
  }
  fabEl.hidden = false;
  render(fabEl, html`
    <div class="fab-menu" hidden>
      <a href="#/log/new">📒 활동 일지</a>
      <a href="#/research/new">📚 이론 조사</a>
      <a href="#/measure/new">📈 측정 기록</a>
      <a href="#/reflection/new">🪞 이번 주 성찰</a>
      <a href="#/plan">📝 개인 계획서</a>
      <a href="#/supplies/new">🛒 물품 신청</a>
    </div>
    <button type="button" class="fab-btn" aria-label="기록하기" aria-expanded="false">＋</button>
  `);
  const menu = fabEl.querySelector('.fab-menu');
  const btn = fabEl.querySelector('.fab-btn');
  btn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', () => { menu.hidden = true; });
}

// 화면마다 새 상자를 만들어 넘겨요. 늦게 도착한 이전 화면의 데이터가 새 화면을 덮어쓰지 않게 하려고요.
function freshView() {
  const view = document.createElement('div');
  appEl.replaceChildren(view);
  return view;
}

async function route() {
  const appEl = freshView();
  const [rawPath, query = ''] = (location.hash.replace(/^#/, '') || '/home').split('?');
  const path = rawPath || '/home';
  const params = new URLSearchParams(query);

  // 외부 공개 페이지는 로그인하지 않아도 봐요.
  if (path === '/showcase') {
    renderNav(path);
    window.scrollTo(0, 0);
    return showcaseView(appEl, ctx);
  }
  if (!state.session) {
    renderNav('/login');
    return loginView(appEl, ctx);
  }
  if (state.me.must_change_password) {
    renderNav('/password');
    return passwordView(appEl, ctx, { forced: true });
  }
  if (!state.me.profile_completed) {
    renderNav('/profile');
    return profileView(appEl, ctx);
  }

  renderNav(path);
  window.scrollTo(0, 0);
  const isStudent = state.me.role === 'student';
  const edit = path.match(/^\/(log|research)\/(new|\d+)$/);
  if (edit) {
    if (!isStudent) return go('/records');
    const id = edit[2] === 'new' ? null : edit[2];
    return edit[1] === 'log' ? logFormView(appEl, ctx, id) : researchFormView(appEl, ctx, id);
  }
  const refl = path.match(/^\/reflection\/(new|\d+)$/);
  if (refl) return isStudent ? reflectionFormView(appEl, ctx, refl[1] === 'new' ? null : refl[1], params) : go('/records');
  const measure = path.match(/^\/measure\/(new|\d+)$/);
  if (measure) return isStudent ? measureFormView(appEl, ctx, measure[1] === 'new' ? null : measure[1]) : go('/measure');
  const purchase = path.match(/^\/supplies\/(new|\d+)$/);
  if (purchase) return purchaseFormView(appEl, ctx, purchase[1] === 'new' ? null : purchase[1]);
  const teamPage = path.match(/^\/team\/(\d+)$/);
  if (teamPage) return teamView(appEl, ctx, teamPage[1]);
  switch (path) {
    case '/teams':
      return teamsView(appEl, ctx);
    case '/tasks':
      return tasksView(appEl, ctx, params);
    case '/supplies':
      return suppliesView(appEl, ctx, params);
    case '/gallery':
      return galleryView(appEl, ctx, params);
    case '/records':
      return recordsView(appEl, ctx, params);
    case '/plan':
      return isStudent ? planView(appEl, ctx) : go('/records');
    case '/library':
      return libraryView(appEl, ctx);
    case '/alerts':
      return alertsView(appEl, ctx);
    case '/schedule':
      return scheduleView(appEl, ctx, params);
    case '/progress':
      return progressView(appEl, ctx, params);
    case '/measure':
      return measureView(appEl, ctx, params);
    case '/requests':
      return requestsView(appEl, ctx, params);
    case '/links':
      return linksView(appEl, ctx);
    case '/present':
      return presentView(appEl, ctx, params);
    case '/showcase/settings':
      return isStaff() ? showcaseSettingsView(appEl, ctx) : go('/home');
    case '/roles':
      return rolesView(appEl, ctx, params);
    case '/portfolio':
      return portfolioView(appEl, ctx, params);
    case '/search':
      return searchView(appEl, ctx, params);
    case '/backup':
      return backupView(appEl, ctx);
    case '/guide':
      return guideView(appEl, ctx);
    case '/me':
      return meView(appEl, ctx);
    case '/admin':
      if (isStaff()) return adminView(appEl, ctx);
      return go('/home');
    case '/home':
      return homeView(appEl, ctx);
    default:
      return go('/home');
  }
}

window.addEventListener('hashchange', route);

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && state.session) {
    state.session = null;
    state.me = null;
    route();
  }
});

(async function start() {
  try {
    await refreshMe();
  } catch (err) {
    console.error(err);
    state.session = null;
  }
  route();
})();
