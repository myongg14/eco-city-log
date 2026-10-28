// 쓰다 만 글 자동 임시 저장. 글쓰기 칸에 입력하면 이 기기(브라우저)에 바로 저장하고,
// 사이트를 나갔다 다시 들어오면 불러와요. 데이터베이스에도 본인만 보게 보관해서 다른 기기에서도 이어 써요. 저장 버튼을 눌러 제대로 저장되면 임시 저장은 지워요.
import { sb } from './api.js';
import { html, raw } from './ui.js';

const FORMS = ['#log-form', '#rs-form', '#rf-form', '#plan-form', '#ms-form', '#pr-form', '#rq-form', '#nt-form', '#task-form', '#ev-form',
  '#peer-form', '#lk-form', '.comment-form'].join(',');
const PREFIX = 'draft:';
const KEEP_DAYS = 14;

let userId = null;
let observer = null;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    const d = JSON.parse(storage()?.getItem(key) || 'null');
    if (!d || Date.now() - d.at > KEEP_DAYS * 86400000) return null;
    return d;
  } catch {
    return null;
  }
}

function write(key, values) {
  try {
    storage()?.setItem(key, JSON.stringify({ at: Date.now(), values }));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 임시 저장 없이 그냥 써요.
  }
}

function remove(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    // 무시
  }
}

// 저장할 칸: 글자·숫자·날짜 칸, 고르기, 체크. 사진·비밀번호는 빼요.
function fields(form) {
  return [...form.elements].filter((e) => e.name && !e.disabled && !['file', 'password', 'submit', 'button', 'hidden'].includes(e.type));
}

function snapshot(form) {
  return fields(form).map((e) => [e.name, e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? e.value || 'on' : null) : e.value]);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function apply(form, values) {
  // 측정값 표처럼 줄이 늘어나는 칸은 모자란 만큼 줄을 더해요.
  const grow = form.querySelector('[data-draft-grow]');
  if (grow) {
    const want = (name) => values.filter(([n]) => n === name).length;
    const have = (name) => fields(form).filter((e) => e.name === name).length;
    const name = grow.dataset.draftGrow;
    for (let i = 0; i < 100 && have(name) < want(name); i++) grow.click();
  }
  const els = fields(form);
  const used = new Set();
  for (const [name, value] of values) {
    const el = els.find((e) => e.name === name && !used.has(e));
    if (!el) continue;
    used.add(el);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value !== null;
    else el.value = value ?? '';
  }
  form.dispatchEvent(new Event('input', { bubbles: true }));
}

function formKey(form, index) {
  const path = (location.hash.replace(/^#/, '') || '/home').split('?')[0];
  const name = form.id || `${form.className.split(' ')[0]}:${form.dataset.kind || ''}:${form.dataset.id || index}`;
  return `${path}:${name}`;
}

function timeLabel(at) {
  return new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

// ---- 다른 기기에서 이어 쓰기: 데이터베이스의 drafts 표 (본인만 봄) ----
let serverOn = true;          // 09 SQL 을 아직 안 돌렸으면 꺼요.
let serverCache = null;       // Promise<Map<key, {at, values}>>

function loadServer() {
  if (!serverOn) return Promise.resolve(new Map());
  serverCache = (async () => {
    const { data, error } = await sb.from('drafts').select('key, data, updated_at').eq('user_id', userId);
    if (error) {
      serverOn = false;
      return new Map();
    }
    return new Map((data || []).map((r) => [r.key, { at: new Date(r.updated_at).getTime(), values: r.data }]));
  })();
  return serverCache;
}

async function pushServer(key, values) {
  if (!serverOn) return;
  const { error } = values
    ? await sb.rpc('save_draft', { p_key: key, p_data: values })
    : await sb.rpc('delete_draft', { p_key: key });
  if (error && /function|schema cache|does not exist/i.test(error.message)) serverOn = false;
  const cache = await serverCache;
  if (cache) {
    if (values) cache.set(key, { at: Date.now(), values });
    else cache.delete(key);
  }
}

function openParents(form) {
  let parent = form.parentElement;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
}

function hook(form, index) {
  if (form.dataset.draft) return;
  form.dataset.draft = '1';
  const key = formKey(form, index);
  const localKey = `${PREFIX}${userId}:${key}`;
  const initial = snapshot(form);
  let submittedAt = 0;
  let timer = null;
  let serverTimer = null;
  let bar = null;

  const forget = () => {
    clearTimeout(timer);
    clearTimeout(serverTimer);
    remove(localKey);
    pushServer(key, null);
  };

  const restore = (saved) => {
    apply(form, saved.values);
    openParents(form);
    bar?.remove();
    bar = document.createElement('p');
    bar.className = 'draft-bar';
    bar.innerHTML = String(html`📝 쓰다 만 글을 불러왔어요 (${timeLabel(saved.at)} 임시 저장). ${raw('<button type="button" class="link-button small">처음 상태로</button>')}`);
    bar.querySelector('button').addEventListener('click', () => {
      forget();
      apply(form, initial);
      bar.remove();
    });
    form.prepend(bar);
  };

  const local = read(localKey);
  if (local && !same(local.values, initial)) restore(local);
  // 다른 기기에서 더 나중에 쓴 글이 있으면, 아직 손대지 않았을 때만 바꿔 넣어요.
  const shown = snapshot(form);
  (serverCache || loadServer()).then((cache) => {
    const remote = cache.get(key);
    if (!remote || !form.isConnected || submittedAt) return;
    if (local && local.at >= remote.at) return;
    if (!same(snapshot(form), shown) || same(remote.values, snapshot(form))) return;
    restore(remote);
    write(localKey, remote.values);
  });

  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = snapshot(form);
      if (same(now, initial)) {
        forget();
        return;
      }
      write(localKey, now);
      clearTimeout(serverTimer);
      serverTimer = setTimeout(() => pushServer(key, now), 1500);
    }, 400);
  };
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('reset', forget);
  form.addEventListener('submit', () => {
    // 저장에 성공하면 화면이 바뀌면서 이 칸이 사라져요. 그때 임시 저장을 지워요.
    submittedAt = Date.now();
    clearTimeout(timer);
    write(localKey, snapshot(form));
    const check = setInterval(() => {
      if (!form.isConnected) {
        if (Date.now() - submittedAt < 15000) forget();
        clearInterval(check);
      } else if (Date.now() - submittedAt > 15000) {
        clearInterval(check);
      }
    }, 200);
  });
}

function scan(root) {
  if (!userId) return;
  root.querySelectorAll(FORMS).forEach((form, i) => hook(form, i));
}

// 로그인한 사람마다 따로 저장해요. 화면을 옮길 때마다 다른 기기에서 쓴 임시 저장을 새로 받아요.
export function startDrafts(appEl, uid) {
  if (userId !== uid) serverOn = true;
  userId = uid;
  loadServer();
  if (!observer) {
    observer = new MutationObserver(() => scan(appEl));
    observer.observe(appEl, { childList: true, subtree: true });
  }
  scan(appEl);
}

export function stopDrafts() {
  userId = null;
  serverCache = null;
}
