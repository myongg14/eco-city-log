-- =====================================================================
-- 에코시티 기록 사이트 · 5-2단계 (기능 구현 현황, 실험·측정 기록장, 팀원 상호 피드백, 팀 간 요청 게시판)
-- 01 ~ 06 을 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 기능 구현 현황: 팀마다 친환경 기능을 설계 → 부품 확보 → 제작 → 작동 확인 단계로 표시
create table if not exists public.features (
  id          bigint generated always as identity primary key,
  team_id     int not null references public.teams(id) on delete cascade,
  name        text not null,
  stage       text not null default '설계' check (stage in ('설계', '부품 확보', '제작', '작동 확인')),
  note        text,
  sort_order  int not null default 0,
  updated_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists features_team_idx on public.features (team_id, sort_order);

-- 실험·측정 기록: 측정 1묶음 = 표 하나 (x 값과 측정값 y)
create table if not exists public.measurements (
  id          bigint generated always as identity primary key,
  author_id   uuid not null references public.profiles(user_id) on delete cascade,
  team_id     int references public.teams(id),
  log_id      bigint references public.activity_logs(id) on delete set null,   -- 관련 일지 (고르지 않아도 됨)
  title       text not null,
  x_label     text not null,       -- 예: 시간(초), 회차, 전류(A)
  y_label     text not null,       -- 예: 전압
  unit        text,                -- 예: V
  points      jsonb not null default '[]',   -- [{"x": "1", "y": 5.02, "note": ""}]
  conclusion  text,
  measured_on date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists measurements_author_idx on public.measurements (author_id, measured_on desc);

-- 팀원 상호 피드백: 활동 뒤 서로의 기여를 한 줄씩 칭찬·조언
create table if not exists public.peer_feedback (
  id          bigint generated always as identity primary key,
  from_id     uuid not null references public.profiles(user_id) on delete cascade,
  to_id       uuid not null references public.profiles(user_id) on delete cascade,
  kind        text not null check (kind in ('칭찬', '조언')),
  body        text not null,
  log_id      bigint references public.activity_logs(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (from_id <> to_id)
);
create index if not exists peer_feedback_to_idx on public.peer_feedback (to_id, created_at desc);

-- 팀 간 요청 게시판: 다른 팀에 사양을 묻거나 도움 요청
create table if not exists public.team_requests (
  id          bigint generated always as identity primary key,
  author_id   uuid not null references public.profiles(user_id) on delete cascade,
  from_team   int references public.teams(id) on delete set null,
  to_team     int not null references public.teams(id) on delete cascade,
  title       text not null,
  body        text not null,
  status      text not null default '열림' check (status in ('열림', '해결')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists team_requests_to_idx on public.team_requests (to_team, created_at desc);

create table if not exists public.request_replies (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.team_requests(id) on delete cascade,
  author_id   uuid not null references public.profiles(user_id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists request_replies_req_idx on public.request_replies (request_id, created_at);

alter table public.features        enable row level security;
alter table public.measurements    enable row level security;
alter table public.peer_feedback   enable row level security;
alter table public.team_requests   enable row level security;
alter table public.request_replies enable row level security;

revoke all on public.features, public.measurements, public.peer_feedback, public.team_requests, public.request_replies from anon, authenticated;
grant select on public.features, public.measurements, public.peer_feedback, public.team_requests, public.request_replies to authenticated;

drop policy if exists features_select on public.features;
create policy features_select on public.features
  for select to authenticated using (public.is_active_member());

drop policy if exists measurements_select on public.measurements;
create policy measurements_select on public.measurements
  for select to authenticated using (public.can_see_author(author_id));

-- 상호 피드백은 받은 사람, 쓴 사람, 관리자·선생님만 봐요.
drop policy if exists peer_feedback_select on public.peer_feedback;
create policy peer_feedback_select on public.peer_feedback
  for select to authenticated
  using (public.is_active_member() and (to_id = auth.uid() or from_id = auth.uid() or public.is_staff()));

drop policy if exists team_requests_select on public.team_requests;
create policy team_requests_select on public.team_requests
  for select to authenticated using (public.is_active_member());

drop policy if exists request_replies_select on public.request_replies;
create policy request_replies_select on public.request_replies
  for select to authenticated using (public.is_active_member());

-- ---------------------------------------------------------------------
-- 기능 구현 현황: 관리자·선생님과 그 팀 학생이 고쳐요.
-- ---------------------------------------------------------------------

create or replace function private.require_team_editor(p_team int) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if public.is_staff() then
    return;
  end if;
  if (select team_id from public.profiles where user_id = auth.uid()) is distinct from p_team then
    raise exception '우리 팀 기능만 고칠 수 있어요.';
  end if;
end;
$$;
revoke execute on function private.require_team_editor(int) from public, anon, authenticated;

create or replace function public.save_feature(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_team int;
  v_stage text := coalesce(nullif(trim(p_data->>'stage'), ''), '설계');
  v_order int;
begin
  if v_stage not in ('설계', '부품 확보', '제작', '작동 확인') then
    raise exception '단계는 설계, 부품 확보, 제작, 작동 확인 중에서 골라 주세요.';
  end if;
  begin
    v_order := coalesce(nullif(trim(coalesce(p_data->>'sort_order', '')), '')::int, 0);
  exception when others then
    raise exception '순서는 숫자로 입력해 주세요.';
  end;
  if p_id is null then
    v_team := private.clean_team(p_data->>'team_id');
    if v_team is null then
      raise exception '팀을 골라 주세요.';
    end if;
    perform private.require_team_editor(v_team);
    insert into public.features (team_id, name, stage, note, sort_order, updated_by)
    values (v_team, private.clean_text(p_data->>'name', '기능 이름', true, 200), v_stage,
            private.clean_text(p_data->>'note', '메모', false, 1000), v_order, auth.uid())
    returning id into v_id;
  else
    select team_id into v_team from public.features where id = p_id;
    if not found then
      raise exception '그 기능을 찾을 수 없어요.';
    end if;
    perform private.require_team_editor(v_team);
    update public.features set
      name       = private.clean_text(p_data->>'name', '기능 이름', true, 200),
      stage      = v_stage,
      note       = private.clean_text(p_data->>'note', '메모', false, 1000),
      sort_order = v_order,
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_feature(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_team int;
begin
  select team_id into v_team from public.features where id = p_id;
  if not found then
    raise exception '그 기능을 찾을 수 없어요.';
  end if;
  perform private.require_team_editor(v_team);
  delete from public.features where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 실험·측정 기록 (학생)
-- ---------------------------------------------------------------------

create or replace function public.save_measurement(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_team int := private.require_writer();
  v_id bigint;
  v_points jsonb := '[]';
  v_row jsonb;
  v_x text;
  v_y numeric;
  v_log bigint;
  v_day date;
begin
  if jsonb_typeof(p_data->'points') = 'array' then
    for v_row in select jsonb_array_elements(p_data->'points') loop
      v_x := private.clean_text(v_row->>'x', '가로축 값', false, 50);
      if v_x is null and nullif(trim(coalesce(v_row->>'y', '')), '') is null then
        continue;
      end if;
      begin
        v_y := trim(v_row->>'y')::numeric;
      exception when others then
        raise exception '측정값은 숫자로 입력해 주세요. (%)', coalesce(v_row->>'y', '빈칸');
      end;
      if v_x is null then
        raise exception '측정값 %의 가로축 값(회차, 시간 등)을 써 주세요.', v_y;
      end if;
      v_points := v_points || jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y,
        'note', coalesce(private.clean_text(v_row->>'note', '메모', false, 200), '')));
    end loop;
  end if;
  if jsonb_array_length(v_points) = 0 then
    raise exception '측정값을 한 줄 이상 입력해 주세요.';
  end if;
  if jsonb_array_length(v_points) > 100 then
    raise exception '측정값은 한 묶음에 100줄까지예요.';
  end if;
  v_day := private.clean_date(p_data->>'measured_on', '측정한 날', true);
  begin
    v_log := nullif(trim(coalesce(p_data->>'log_id', '')), '')::bigint;
  exception when others then
    raise exception '관련 일지를 다시 골라 주세요.';
  end;
  if v_log is not null and not exists (
    select 1 from public.activity_logs l where l.id = v_log
      and (l.author_id = auth.uid() or exists (select 1 from public.log_participants p where p.log_id = l.id and p.user_id = auth.uid()))
  ) then
    raise exception '관련 일지는 내가 쓰거나 같이 한 일지에서 골라 주세요.';
  end if;

  if p_id is null then
    insert into public.measurements (author_id, team_id, log_id, title, x_label, y_label, unit, points, conclusion, measured_on)
    values (
      auth.uid(), v_team, v_log,
      private.clean_text(p_data->>'title', '측정 이름', true, 200),
      private.clean_text(p_data->>'x_label', '가로축 이름', true, 50),
      private.clean_text(p_data->>'y_label', '측정한 것', true, 50),
      private.clean_text(p_data->>'unit', '단위', false, 20),
      v_points,
      private.clean_text(p_data->>'conclusion', '결과 해석', false, 2000),
      v_day
    ) returning id into v_id;
  else
    update public.measurements set
      log_id      = v_log,
      title       = private.clean_text(p_data->>'title', '측정 이름', true, 200),
      x_label     = private.clean_text(p_data->>'x_label', '가로축 이름', true, 50),
      y_label     = private.clean_text(p_data->>'y_label', '측정한 것', true, 50),
      unit        = private.clean_text(p_data->>'unit', '단위', false, 20),
      points      = v_points,
      conclusion  = private.clean_text(p_data->>'conclusion', '결과 해석', false, 2000),
      measured_on = v_day,
      updated_at  = now()
    where id = p_id and author_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception '내가 쓴 측정 기록만 고칠 수 있어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_measurement(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_writer();
  delete from public.measurements where id = p_id and author_id = auth.uid();
  if not found then
    raise exception '내가 쓴 측정 기록만 지울 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 팀원 상호 피드백 (학생 → 다른 학생)
-- ---------------------------------------------------------------------

create or replace function public.add_peer_feedback(p_to uuid, p_kind text, p_body text, p_log bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  perform private.require_writer();
  if p_kind not in ('칭찬', '조언') then
    raise exception '칭찬 또는 조언을 골라 주세요.';
  end if;
  if p_to = auth.uid() then
    raise exception '나에게는 피드백을 남길 수 없어요.';
  end if;
  if not exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
    where p.user_id = p_to and p.role = 'student' and t.is_active
  ) then
    raise exception '피드백은 학생 계정에게만 남길 수 있어요.';
  end if;
  if p_log is not null and not exists (select 1 from public.activity_logs where id = p_log) then
    raise exception '관련 일지를 찾을 수 없어요.';
  end if;
  insert into public.peer_feedback (from_id, to_id, kind, body, log_id)
  values (auth.uid(), p_to, p_kind, private.clean_text(p_body, '피드백', true, 300), p_log)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_peer_feedback(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.peer_feedback where id = p_id and from_id = auth.uid();
  if not found then
    raise exception '내가 쓴 피드백만 지울 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 팀 간 요청 게시판
-- ---------------------------------------------------------------------

create or replace function public.save_team_request(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_from int;
  v_to int := private.clean_team(p_data->>'to_team');
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if v_to is null then
    raise exception '요청할 팀을 골라 주세요.';
  end if;
  select team_id into v_from from public.profiles where user_id = auth.uid();
  if v_from = v_to then
    raise exception '우리 팀이 아닌 다른 팀을 골라 주세요.';
  end if;
  if p_id is null then
    insert into public.team_requests (author_id, from_team, to_team, title, body)
    values (auth.uid(), v_from, v_to,
      private.clean_text(p_data->>'title', '요청 제목', true, 200),
      private.clean_text(p_data->>'body', '요청 내용', true, 2000))
    returning id into v_id;
  else
    update public.team_requests set
      to_team    = v_to,
      title      = private.clean_text(p_data->>'title', '요청 제목', true, 200),
      body       = private.clean_text(p_data->>'body', '요청 내용', true, 2000),
      updated_at = now()
    where id = p_id and author_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception '내가 쓴 요청만 고칠 수 있어요.';
    end if;
  end if;
  return v_id;
end;
$$;

-- 해결 표시: 요청한 사람, 요청받은 팀 학생, 관리자·선생님
create or replace function public.set_request_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_req public.team_requests;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if p_status not in ('열림', '해결') then
    raise exception '상태는 열림 또는 해결이에요.';
  end if;
  select * into v_req from public.team_requests where id = p_id;
  if not found then
    raise exception '그 요청을 찾을 수 없어요.';
  end if;
  if not (public.is_staff() or v_req.author_id = auth.uid()
          or v_req.to_team = (select team_id from public.profiles where user_id = auth.uid())) then
    raise exception '요청한 사람이나 요청받은 팀만 해결 표시를 할 수 있어요.';
  end if;
  update public.team_requests set
    status = p_status,
    resolved_at = case when p_status = '해결' then now() end,
    updated_at = now()
  where id = p_id;
end;
$$;

create or replace function public.delete_team_request(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.team_requests where id = p_id and (author_id = auth.uid() or public.is_staff());
  if not found then
    raise exception '내가 쓴 요청만 지울 수 있어요.';
  end if;
end;
$$;

create or replace function public.add_request_reply(p_request bigint, p_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if not exists (select 1 from public.team_requests where id = p_request) then
    raise exception '그 요청을 찾을 수 없어요.';
  end if;
  insert into public.request_replies (request_id, author_id, body)
  values (p_request, auth.uid(), private.clean_text(p_body, '답변', true, 2000))
  returning id into v_id;
  update public.team_requests set updated_at = now() where id = p_request;
  return v_id;
end;
$$;

create or replace function public.delete_request_reply(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.request_replies where id = p_id and (author_id = auth.uid() or public.is_staff());
  if not found then
    raise exception '내가 쓴 답변만 지울 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.save_feature(bigint, jsonb)                      from public, anon;
revoke execute on function public.delete_feature(bigint)                           from public, anon;
revoke execute on function public.save_measurement(bigint, jsonb)                  from public, anon;
revoke execute on function public.delete_measurement(bigint)                       from public, anon;
revoke execute on function public.add_peer_feedback(uuid, text, text, bigint)      from public, anon;
revoke execute on function public.delete_peer_feedback(bigint)                     from public, anon;
revoke execute on function public.save_team_request(bigint, jsonb)                 from public, anon;
revoke execute on function public.set_request_status(bigint, text)                 from public, anon;
revoke execute on function public.delete_team_request(bigint)                      from public, anon;
revoke execute on function public.add_request_reply(bigint, text)                  from public, anon;
revoke execute on function public.delete_request_reply(bigint)                     from public, anon;

grant execute on function public.save_feature(bigint, jsonb)                      to authenticated;
grant execute on function public.delete_feature(bigint)                           to authenticated;
grant execute on function public.save_measurement(bigint, jsonb)                  to authenticated;
grant execute on function public.delete_measurement(bigint)                       to authenticated;
grant execute on function public.add_peer_feedback(uuid, text, text, bigint)      to authenticated;
grant execute on function public.delete_peer_feedback(bigint)                     to authenticated;
grant execute on function public.save_team_request(bigint, jsonb)                 to authenticated;
grant execute on function public.set_request_status(bigint, text)                 to authenticated;
grant execute on function public.delete_team_request(bigint)                      to authenticated;
grant execute on function public.add_request_reply(bigint, text)                  to authenticated;
grant execute on function public.delete_request_reply(bigint)                     to authenticated;

-- 확인: 표 5개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('features', 'measurements', 'peer_feedback', 'team_requests', 'request_replies')
order by table_name;
