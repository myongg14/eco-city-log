import { sb, fetchMyProfile, fetchTeams } from './api.js';
import { html, render } from './ui.js';
import { loginView } from './views/login.js';
import { passwordView } from './views/password.js';
import { profileView } from './views/profile.js';
import { homeView } from './views/home.js';
import { meView } from './views/me.js';
import { adminView } from './views/admin.js';

const state = {
  session: null,
  me: null,          // profiles 행
  team: null,        // 내 팀
  previousLoginAt: null,
};

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');

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
  if (state.me.team_id) {
    const teams = await fetchTeams();
    state.team = teams.find((t) => t.id === state.me.team_id) || null;
  } else {
    state.team = null;
  }
}

export async function logout() {
  await sb.auth.signOut();
  state.session = null;
  state.me = null;
  state.team = null;
  go('/login');
}

const ctx = { state, go, refreshMe, logout };

function isStaff() {
  return state.me && (state.me.role === 'admin' || state.me.role === 'teacher');
}

function renderNav(current) {
  if (!state.me || state.me.must_change_password || !state.me.profile_completed) {
    navEl.hidden = true;
    navEl.innerHTML = '';
    return;
  }
  const links = [
    { path: '/home', label: '홈' },
    { path: '/me', label: '내 정보' },
  ];
  if (isStaff()) links.push({ path: '/admin', label: '관리' });
  navEl.hidden = false;
  render(navEl, html`
    ${links.map((l) => html`<a href="#${l.path}" class="${l.path === current ? 'active' : ''}">${l.label}</a>`)}
    <button type="button" class="link-button" id="logout-btn">로그아웃</button>
  `);
  navEl.querySelector('#logout-btn').addEventListener('click', logout);
}

async function route() {
  const path = (location.hash.replace(/^#/, '') || '/home').split('?')[0];

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
  switch (path) {
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
