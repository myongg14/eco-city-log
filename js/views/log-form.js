import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchLogs, fetchParticipants, fetchPeople, fetchPhotos, ACTIVITY_TYPES, AREAS, SUBJECTS, splitLines, todayKst } from '../records.js';
import { uploadLogPhotos, deletePhoto, signedUrls, MAX_PHOTOS_PER_LOG } from '../photos.js';
import { field, selectField, checkGroup, checkedValues, bindVagueHints, saveSubjects } from '../form.js';

// id 가 없으면 새로 쓰기
export async function logFormView(el, ctx, id) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let log = {};
  let joined = [];
  let photos = [];
  let urls = new Map();
  let people;
  let teams;
  try {
    people = await fetchPeople();
    teams = ctx.state.teams || [];
    if (id) {
      [log] = await fetchLogs({ id });
      if (!log || log.author_id !== me.user_id) {
        render(el, html`<section class="card"><p class="message error">내가 쓴 일지만 고칠 수 있어요.</p></section>`);
        return;
      }
      joined = (await fetchParticipants([log.id])).get(log.id) || [];
      photos = (await fetchPhotos({ logIds: [log.id] })).get(log.id) || [];
      urls = await signedUrls(photos).catch(() => new Map());
    }
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const students = [...people.values()].filter((p) => p.role === 'student' && p.user_id !== me.user_id);
  const option = (p) => ({ value: p.user_id, label: p.display_name ? `${p.display_name} (${p.login_id})` : p.login_id });
  const myTeam = students.filter((p) => p.team_id === me.team_id);
  const others = students.filter((p) => p.team_id !== me.team_id);
  const otherChosen = others.some((p) => joined.includes(p.user_id));

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${id ? '활동 일지 고치기' : '활동 일지'}</h1>
      <p class="muted">활동한 날마다 써요. 무엇을, 어떻게, 몇 번 했는지 숫자로 남기면 좋아요.</p>
      <form id="log-form" novalidate>
        <div class="field-row">
          ${field({ name: 'log_date', label: '날짜', required: true, type: 'date', value: log.log_date || todayKst(), attrs: `max="${todayKst()}"` })}
          ${field({ name: 'minutes', label: '활동 시간(분)', required: true, type: 'number', placeholder: '50', value: log.minutes, attrs: 'inputmode="numeric" min="1" max="1440"' })}
          ${selectField({ name: 'activity_type', label: '활동 유형', required: true, options: ACTIVITY_TYPES, value: log.activity_type })}
        </div>
        ${field({ name: 'did', label: '한 일', required: true, type: 'textarea', rows: 5,
          placeholder: '예: 아두이노에 수위 센서를 연결하고 물 높이 5cm, 10cm, 15cm에서 값을 읽음', value: log.did })}
        ${field({ name: 'problem', label: '문제와 해결', type: 'textarea', rows: 4,
          placeholder: '예: 센서 값이 튀어서 10번 읽은 평균값으로 보정함', value: log.problem })}
        ${field({ name: 'results', label: '실험 결과·측정값', type: 'textarea', rows: 3,
          placeholder: '예: 3회 측정 평균 12cm (11.8 / 12.1 / 12.0)', value: log.results })}
        ${checkGroup({ name: 'participants', label: '같이 한 우리 팀원', options: myTeam.map(option), values: joined,
          hint: myTeam.length ? '' : '우리 팀에 다른 팀원이 없어요.' })}
        ${others.length ? html`
          <details class="field" ${otherChosen ? 'open' : ''}>
            <summary>다른 팀 학생도 같이 했어요</summary>
            ${teams.filter((t) => others.some((p) => p.team_id === t.id)).map((t) => checkGroup({
              name: 'participants', label: t.name, options: others.filter((p) => p.team_id === t.id).map(option), values: joined,
            }))}
          </details>` : ''}
        ${field({ name: 'next_steps', label: '다음 할 일', type: 'textarea', rows: 2,
          placeholder: '펌프 연결\n방수 처리', hint: '한 줄에 하나씩 써요.', value: (log.next_steps || []).join('\n') })}
        ${checkGroup({ name: 'areas', label: '생기부 영역 (고르지 않아도 돼요)', options: AREAS, values: log.areas })}
        ${checkGroup({ name: 'subjects', label: '연계 교과 (고르지 않아도 돼요)', options: SUBJECTS, values: log.subjects,
          hint: '이 활동에서 쓴 교과 지식을 고르면 생기부 정리에서 교과별로 모여요.' })}
        <fieldset class="field checks">
          <legend>사진 (최대 ${MAX_PHOTOS_PER_LOG}장)</legend>
          <div class="thumbs" id="log-photos">
            ${photos.map((ph) => html`
              <figure class="thumb" data-photo="${ph.id}">
                ${urls.get(ph.path) ? html`<img src="${urls.get(ph.path)}" alt="일지 사진" loading="lazy">` : html`<span class="muted small">불러오지 못함</span>`}
                <button type="button" class="danger thumb-del" data-del-photo="${ph.id}" aria-label="사진 지우기">✕</button>
              </figure>`)}
          </div>
          <input type="file" id="log-files" accept="image/*" multiple ${photos.length >= MAX_PHOTOS_PER_LOG ? 'disabled' : ''}>
          <p class="hint">작업 전후, 측정하는 모습을 찍어 두면 제작 과정이 갤러리에 모여요. 사진은 올릴 때 자동으로 줄여요.</p>
        </fieldset>
        <p class="message" id="log-msg" hidden></p>
        <button type="submit" class="primary" id="log-btn">저장</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#log-form');
  const msg = el.querySelector('#log-msg');
  const btn = el.querySelector('#log-btn');
  bindVagueHints(form);
  const filesInput = el.querySelector('#log-files');

  el.querySelector('#log-photos').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-photo]');
    if (!del || !window.confirm('이 사진을 지울까요?')) return;
    del.disabled = true;
    try {
      await deletePhoto(Number(del.dataset.delPhoto));
      del.closest('.thumb').remove();
      photos = photos.filter((ph) => ph.id !== Number(del.dataset.delPhoto));
      filesInput.disabled = false;
      toast('사진을 지웠어요.');
    } catch (err) {
      toast(err.message);
      del.disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const v = (n) => form.elements[n].value.trim();
    const data = {
      log_date: v('log_date'),
      minutes: v('minutes'),
      activity_type: v('activity_type'),
      did: v('did'),
      problem: v('problem'),
      results: v('results'),
      next_steps: splitLines(form.elements.next_steps.value),
      areas: checkedValues(form, 'areas'),
      participants: [...new Set(checkedValues(form, 'participants'))],
    };
    if (!data.log_date || !data.minutes || !data.activity_type || !data.did) {
      return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    }
    const minutes = Number(data.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return showMessage(msg, '활동 시간은 1~1440분으로 입력해 주세요.');
    }

    const files = [...(filesInput.files || [])];
    if (photos.length + files.length > MAX_PHOTOS_PER_LOG) {
      return showMessage(msg, `사진은 일지 하나에 ${MAX_PHOTOS_PER_LOG}장까지예요. 지금 ${photos.length}장이 있어요.`);
    }

    setBusy(btn, true, '저장 중…');
    try {
      const logId = await rpc('save_log', { p_id: id ? Number(id) : null, p_data: data });
      await saveSubjects('log', logId, checkedValues(form, 'subjects'), log.subjects);
      let failed = 0;
      if (files.length) {
        failed = await uploadLogPhotos(me.user_id, Number(logId), files, (done, all) => { btn.textContent = `사진 올리는 중 ${done}/${all}`; });
      }
      toast(failed ? `일지는 저장했지만 사진 ${failed}장을 올리지 못했어요.` : id ? '일지를 고쳤어요.' : '일지를 저장했어요.');
      ctx.go('/records');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
