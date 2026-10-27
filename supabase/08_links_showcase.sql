-- =====================================================================
-- 에코시티 기록 사이트 · 6단계 (팀 간 연결 지도, 외부 공개 페이지)
-- 01 ~ 07 을 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- 외부 공개 페이지는 처음에 꺼져 있어요. 관리자·선생님이 사이트에서 켜야 보여요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 팀 간 연결: 어느 팀의 결과물이 어느 팀에 필요한지 (예: 발전 설비 → 배터리)
create table if not exists public.team_links (
  id          bigint generated always as identity primary key,
  from_team   int not null references public.teams(id) on delete cascade,
  to_team     int not null references public.teams(id) on delete cascade,
  what        text not null,       -- 주고받는 것 (예: 발전한 전기)
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  check (from_team <> to_team),
  unique (from_team, to_team, what)
);

-- 외부 공개 페이지에 내보낼 측정 기록·사진 (관리자·선생님이 골라요)
create table if not exists public.showcase_items (
  kind      text not null check (kind in ('measurement', 'photo')),
  ref_id    bigint not null,       -- measurements.id 또는 log_photos.id
  added_by  uuid references public.profiles(user_id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (kind, ref_id)
);

alter table public.team_links     enable row level security;
alter table public.showcase_items enable row level security;

revoke all on public.team_links, public.showcase_items from anon, authenticated;
grant select on public.team_links, public.showcase_items to authenticated;

drop policy if exists team_links_select on public.team_links;
create policy team_links_select on public.team_links
  for select to authenticated using (public.is_active_member());

drop policy if exists showcase_items_select on public.showcase_items;
create policy showcase_items_select on public.showcase_items
  for select to authenticated using (public.is_staff());

-- 예시 연결 2개 (계획서의 예). 사이트에서 고치거나 지울 수 있어요.
insert into public.team_links (from_team, to_team, what) values
  (4, 2, '발전한 전기'),
  (2, 1, '저장한 전기 공급')
on conflict do nothing;

insert into public.app_settings (key, value) values ('showcase', '{"enabled": false, "intro": ""}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 팀 간 연결: 관리자·선생님과 보내는 팀 학생이 고쳐요.
-- ---------------------------------------------------------------------

create or replace function private.require_link_editor(p_team int) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.is_staff()
     and (select team_id from public.profiles where user_id = auth.uid()) is distinct from p_team then
    raise exception '우리 팀에서 보내는 연결만 고칠 수 있어요.';
  end if;
end;
$$;
revoke execute on function private.require_link_editor(int) from public, anon, authenticated;

create or replace function public.save_team_link(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_from int := private.clean_team(p_data->>'from_team');
  v_to int := private.clean_team(p_data->>'to_team');
  v_old int;
  v_id bigint;
begin
  if v_from is null or v_to is null then
    raise exception '보내는 팀과 받는 팀을 골라 주세요.';
  end if;
  if v_from = v_to then
    raise exception '서로 다른 팀을 골라 주세요.';
  end if;
  perform private.require_link_editor(v_from);
  if p_id is null then
    insert into public.team_links (from_team, to_team, what, created_by)
    values (v_from, v_to, private.clean_text(p_data->>'what', '주고받는 것', true, 100), auth.uid())
    returning id into v_id;
  else
    select from_team into v_old from public.team_links where id = p_id;
    if not found then
      raise exception '그 연결을 찾을 수 없어요.';
    end if;
    perform private.require_link_editor(v_old);
    update public.team_links set
      from_team = v_from,
      to_team   = v_to,
      what      = private.clean_text(p_data->>'what', '주고받는 것', true, 100)
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception '이미 있는 연결이에요.';
end;
$$;

create or replace function public.delete_team_link(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_from int;
begin
  select from_team into v_from from public.team_links where id = p_id;
  if not found then
    raise exception '그 연결을 찾을 수 없어요.';
  end if;
  perform private.require_link_editor(v_from);
  delete from public.team_links where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 외부 공개 페이지 설정 (관리자·선생님)
-- ---------------------------------------------------------------------

create or replace function public.set_showcase(p_enabled boolean, p_intro text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  insert into public.app_settings (key, value)
  values ('showcase', jsonb_build_object('enabled', coalesce(p_enabled, false),
                                         'intro', coalesce(private.clean_text(p_intro, '소개 글', false, 2000), '')))
  on conflict (key) do update set value = excluded.value;
end;
$$;

create or replace function public.set_showcase_item(p_kind text, p_ref bigint, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_kind not in ('measurement', 'photo') then
    raise exception '알 수 없는 종류예요.';
  end if;
  if p_on then
    if p_kind = 'measurement' and not exists (select 1 from public.measurements where id = p_ref) then
      raise exception '그 측정 기록을 찾을 수 없어요.';
    end if;
    if p_kind = 'photo' and not exists (select 1 from public.log_photos where id = p_ref) then
      raise exception '그 사진을 찾을 수 없어요.';
    end if;
    insert into public.showcase_items (kind, ref_id, added_by) values (p_kind, p_ref, auth.uid())
    on conflict do nothing;
  else
    delete from public.showcase_items where kind = p_kind and ref_id = p_ref;
  end if;
end;
$$;

-- 공개가 켜져 있고 관리자·선생님이 고른 사진인지 (Storage 정책에서 써요)
create or replace function public.is_showcase_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'showcase'), false)
     and exists (
       select 1 from public.showcase_items s
       join public.log_photos ph on ph.id = s.ref_id
       where s.kind = 'photo' and ph.path = p_path
     )
$$;

-- 로그인하지 않은 사람도 고른 사진만 볼 수 있어요.
drop policy if exists photos_showcase_read on storage.objects;
create policy photos_showcase_read on storage.objects
  for select to anon
  using (bucket_id = 'photos' and public.is_showcase_photo(name));

-- 외부 공개 페이지에 보여 줄 내용. 학생 이름·아이디·메모는 넣지 않아요.
create or replace function public.public_showcase() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_set jsonb;
begin
  select value into v_set from public.app_settings where key = 'showcase';
  if not coalesce((v_set->>'enabled')::boolean, false) then
    return jsonb_build_object('enabled', false);
  end if;
  return jsonb_build_object(
    'enabled', true,
    'intro', coalesce(v_set->>'intro', ''),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'topic', t.topic,
        'members', (select count(*) from public.profiles p where p.team_id = t.id and p.role = 'student'))
        order by t.id)
      from public.teams t where t.is_active), '[]'),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', f.team_id, 'name', f.name, 'stage', f.stage) order by f.team_id, f.sort_order, f.id)
      from public.features f join public.teams t on t.id = f.team_id and t.is_active), '[]'),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('from_team', l.from_team, 'to_team', l.to_team, 'what', l.what) order by l.id)
      from public.team_links l), '[]'),
    'measurements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'team_id', m.team_id, 'title', m.title, 'x_label', m.x_label, 'y_label', m.y_label, 'unit', m.unit,
        'measured_on', m.measured_on, 'conclusion', m.conclusion,
        'points', (select coalesce(jsonb_agg(jsonb_build_object('x', pt->'x', 'y', pt->'y')), '[]') from jsonb_array_elements(m.points) pt))
        order by m.measured_on)
      from public.showcase_items s join public.measurements m on m.id = s.ref_id
      where s.kind = 'measurement'), '[]'),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('path', ph.path, 'team_id', l.team_id, 'log_date', l.log_date, 'activity_type', l.activity_type)
        order by l.log_date, ph.id)
      from public.showcase_items s
      join public.log_photos ph on ph.id = s.ref_id
      join public.activity_logs l on l.id = ph.log_id
      where s.kind = 'photo'), '[]'),
    'counts', jsonb_build_object(
      'students', (select count(*) from public.profiles p join public.teams t on t.id = p.team_id and t.is_active where p.role = 'student'),
      'logs', (select count(*) from public.activity_logs),
      'research', (select count(*) from public.research_notes),
      'measurements', (select count(*) from public.measurements),
      'photos', (select count(*) from public.log_photos))
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.save_team_link(bigint, jsonb)              from public, anon;
revoke execute on function public.delete_team_link(bigint)                   from public, anon;
revoke execute on function public.set_showcase(boolean, text)                from public, anon;
revoke execute on function public.set_showcase_item(text, bigint, boolean)   from public, anon;
revoke execute on function public.is_showcase_photo(text)                    from public;
revoke execute on function public.public_showcase()                          from public;

grant execute on function public.save_team_link(bigint, jsonb)               to authenticated;
grant execute on function public.delete_team_link(bigint)                    to authenticated;
grant execute on function public.set_showcase(boolean, text)                 to authenticated;
grant execute on function public.set_showcase_item(text, bigint, boolean)    to authenticated;
grant execute on function public.is_showcase_photo(text)                     to anon, authenticated;
grant execute on function public.public_showcase()                           to anon, authenticated;

-- 확인: 표 2개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('team_links', 'showcase_items')
order by table_name;
