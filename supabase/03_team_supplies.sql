-- =====================================================================
-- 에코시티 기록 사이트 · 3단계 (공지, 할 일 보드, 물품 신청·예산, 일지 사진 기록)
-- 사진 파일 저장소는 04_photos_storage.sql 에서 따로 만들어요.
-- 01, 02 를 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 사이트 설정 (총예산 등)
create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);
insert into public.app_settings (key, value) values ('total_budget', '1600000')
on conflict (key) do nothing;

-- 공지: 관리자·선생님이 써요. 고정한 공지는 홈 맨 위에 보여요.
create table if not exists public.notices (
  id          bigint generated always as identity primary key,
  author_id   uuid not null references public.profiles(user_id) on delete cascade,
  title       text not null,
  body        text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 할 일 보드
create table if not exists public.tasks (
  id           bigint generated always as identity primary key,
  title        text not null,
  detail       text,
  team_id      int references public.teams(id) on delete set null,     -- 비어 있으면 전체 할 일
  assignee_id  uuid references public.profiles(user_id) on delete set null,
  due_date     date,
  status       text not null default '예정' check (status in ('예정', '진행', '완료')),
  created_by   uuid references public.profiles(user_id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 물품 신청. 상태: 신청 → 승인 / 반려 → 구매 완료 → 수령 (수령한 물품이 보유 물품)
create table if not exists public.purchase_requests (
  id             bigint generated always as identity primary key,
  requester_id   uuid not null references public.profiles(user_id) on delete cascade,
  team_id        int references public.teams(id) on delete set null,
  item_name      text not null,
  quantity       int not null check (quantity between 1 and 10000),
  unit_price     int not null check (unit_price between 0 and 10000000),
  total_price    int generated always as (quantity * unit_price) stored,
  shop_url       text,
  usage          text not null,
  reason         text not null,
  status         text not null default '신청' check (status in ('신청', '승인', '반려', '구매 완료', '수령')),
  decided_by     uuid references public.profiles(user_id) on delete set null,
  decided_at     timestamptz,
  reject_reason  text,
  purchased_at   timestamptz,
  received_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists purchase_requests_status_idx on public.purchase_requests (status, created_at desc);

-- 일지 사진. 파일은 Storage 의 photos 버킷에 '내 user_id/일지 번호/파일' 로 저장해요.
create table if not exists public.log_photos (
  id          bigint generated always as identity primary key,
  log_id      bigint not null references public.activity_logs(id) on delete cascade,
  author_id   uuid not null references public.profiles(user_id) on delete cascade,
  path        text not null unique,
  caption     text,
  created_at  timestamptz not null default now()
);
create index if not exists log_photos_log_idx on public.log_photos (log_id);

alter table public.app_settings      enable row level security;
alter table public.notices           enable row level security;
alter table public.tasks             enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.log_photos        enable row level security;

-- 읽기만 허용하고, 쓰기는 아래 함수로만 합니다.
revoke all on public.app_settings, public.notices, public.tasks, public.purchase_requests, public.log_photos from anon, authenticated;
grant select on public.app_settings, public.notices, public.tasks, public.purchase_requests, public.log_photos to authenticated;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using (public.is_active_member());

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select to authenticated using (public.is_active_member());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using (public.is_active_member());

drop policy if exists purchase_select on public.purchase_requests;
create policy purchase_select on public.purchase_requests
  for select to authenticated using (public.can_see_author(requester_id));

drop policy if exists log_photos_select on public.log_photos;
create policy log_photos_select on public.log_photos
  for select to authenticated using (public.can_see_author(author_id));

-- ---------------------------------------------------------------------
-- 공지 (관리자·선생님)
-- ---------------------------------------------------------------------

create or replace function public.save_notice(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  perform private.require_staff();
  if p_id is null then
    insert into public.notices (author_id, title, body, pinned)
    values (
      auth.uid(),
      private.clean_text(p_data->>'title', '공지 제목', true, 200),
      private.clean_text(p_data->>'body', '공지 내용', false),
      coalesce((p_data->>'pinned')::boolean, false)
    ) returning id into v_id;
  else
    update public.notices set
      title      = private.clean_text(p_data->>'title', '공지 제목', true, 200),
      body       = private.clean_text(p_data->>'body', '공지 내용', false),
      pinned     = coalesce((p_data->>'pinned')::boolean, false),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '그 공지를 찾을 수 없어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_notice(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  delete from public.notices where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 할 일 보드: 관리자·선생님이 만들고, 맡은 학생은 상태만 바꿔요.
-- ---------------------------------------------------------------------

create or replace function public.save_task(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_team int;
  v_assignee uuid;
  v_due date;
  v_status text := coalesce(nullif(trim(p_data->>'status'), ''), '예정');
begin
  perform private.require_staff();
  begin
    v_team     := nullif(trim(coalesce(p_data->>'team_id', '')), '')::int;
    v_assignee := nullif(trim(coalesce(p_data->>'assignee_id', '')), '')::uuid;
    v_due      := nullif(trim(coalesce(p_data->>'due_date', '')), '')::date;
  exception when others then
    raise exception '팀, 담당자, 마감일을 확인해 주세요.';
  end;
  if v_status not in ('예정', '진행', '완료') then
    raise exception '상태는 예정, 진행, 완료 중에서 골라 주세요.';
  end if;
  if v_team is not null and not exists (select 1 from public.teams where id = v_team) then
    raise exception '그런 팀이 없어요.';
  end if;
  if v_assignee is not null and not exists (select 1 from public.profiles where user_id = v_assignee and role = 'student') then
    raise exception '담당자는 학생 계정에서 골라 주세요.';
  end if;
  -- 담당자를 고르고 팀을 비워 두면 담당자의 팀으로 넣어요.
  if v_team is null and v_assignee is not null then
    select team_id into v_team from public.profiles where user_id = v_assignee;
  end if;

  if p_id is null then
    insert into public.tasks (title, detail, team_id, assignee_id, due_date, status, created_by)
    values (
      private.clean_text(p_data->>'title', '할 일', true, 200),
      private.clean_text(p_data->>'detail', '자세한 내용', false, 2000),
      v_team, v_assignee, v_due, v_status, auth.uid()
    ) returning id into v_id;
  else
    update public.tasks set
      title       = private.clean_text(p_data->>'title', '할 일', true, 200),
      detail      = private.clean_text(p_data->>'detail', '자세한 내용', false, 2000),
      team_id     = v_team,
      assignee_id = v_assignee,
      due_date    = v_due,
      status      = v_status,
      updated_at  = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '그 할 일을 찾을 수 없어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_task(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  delete from public.tasks where id = p_id;
end;
$$;

create or replace function public.set_task_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if p_status not in ('예정', '진행', '완료') then
    raise exception '상태는 예정, 진행, 완료 중에서 골라 주세요.';
  end if;
  update public.tasks set status = p_status, updated_at = now()
  where id = p_id and (public.is_staff() or assignee_id = auth.uid());
  if not found then
    raise exception '나에게 맡겨진 할 일만 상태를 바꿀 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 물품 신청 (학생·선생님이 신청, 승인·반려는 선생님만)
-- ---------------------------------------------------------------------

create or replace function public.save_purchase(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public.my_role();
  v_team int;
  v_id bigint;
  v_qty int;
  v_price int;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if v_role not in ('student', 'teacher') then
    raise exception '물품 신청은 학생과 선생님 계정으로 해요. 관리자는 신청 현황 확인과 구매·수령 기록을 맡아요.';
  end if;
  select team_id into v_team from public.profiles where user_id = auth.uid();

  begin
    v_qty   := trim(coalesce(p_data->>'quantity', ''))::int;
    v_price := trim(coalesce(p_data->>'unit_price', ''))::int;
  exception when others then
    raise exception '수량과 단가는 숫자로 입력해 주세요.';
  end;
  if v_qty is null or v_qty < 1 or v_qty > 10000 then
    raise exception '수량은 1개 이상으로 입력해 주세요.';
  end if;
  if v_price is null or v_price < 0 or v_price > 10000000 then
    raise exception '단가(원)를 확인해 주세요.';
  end if;

  if p_id is null then
    insert into public.purchase_requests (requester_id, team_id, item_name, quantity, unit_price, shop_url, usage, reason)
    values (
      auth.uid(), v_team,
      private.clean_text(p_data->>'item_name', '물품명·규격', true, 200),
      v_qty, v_price,
      private.clean_url(p_data->>'shop_url'),
      private.clean_text(p_data->>'usage', '사용처', true, 200),
      private.clean_text(p_data->>'reason', '필요한 이유', true, 1000)
    ) returning id into v_id;
  else
    -- 승인 전(신청)이나 반려된 신청만 고칠 수 있어요. 반려된 것을 고치면 다시 신청돼요.
    update public.purchase_requests set
      item_name     = private.clean_text(p_data->>'item_name', '물품명·규격', true, 200),
      quantity      = v_qty,
      unit_price    = v_price,
      shop_url      = private.clean_url(p_data->>'shop_url'),
      usage         = private.clean_text(p_data->>'usage', '사용처', true, 200),
      reason        = private.clean_text(p_data->>'reason', '필요한 이유', true, 1000),
      status        = '신청',
      decided_by    = null,
      decided_at    = null,
      reject_reason = null,
      updated_at    = now()
    where id = p_id and requester_id = auth.uid() and status in ('신청', '반려')
    returning id into v_id;
    if v_id is null then
      raise exception '내가 신청한 것 중 승인 전이거나 반려된 것만 고칠 수 있어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_purchase(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.purchase_requests
  where id = p_id and requester_id = auth.uid() and status in ('신청', '반려');
  if not found then
    raise exception '내가 신청한 것 중 승인 전이거나 반려된 것만 지울 수 있어요.';
  end if;
end;
$$;

-- 승인·반려: 선생님만 (모든 신청의 최종 승인자)
create or replace function public.decide_purchase(p_id bigint, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_text(p_reason, '반려 사유', false, 500);
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception '승인과 반려는 선생님만 할 수 있어요.';
  end if;
  if not p_approve and v_reason is null then
    raise exception '반려 사유를 입력해 주세요.';
  end if;
  update public.purchase_requests set
    status        = case when p_approve then '승인' else '반려' end,
    decided_by    = auth.uid(),
    decided_at    = now(),
    reject_reason = case when p_approve then null else v_reason end,
    updated_at    = now()
  where id = p_id and status in ('신청', '승인', '반려');
  if not found then
    raise exception '이미 구매했거나 없는 신청이에요.';
  end if;
end;
$$;

-- 구매·수령 기록: 관리자·선생님. 한 단계씩 앞으로, 잘못 눌렀으면 한 단계 뒤로.
create or replace function public.set_purchase_stage(p_id bigint, p_stage text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_now text;
begin
  perform private.require_staff();
  select status into v_now from public.purchase_requests where id = p_id;
  if v_now is null then
    raise exception '그 신청을 찾을 수 없어요.';
  end if;
  if not (
       (v_now = '승인' and p_stage = '구매 완료')
    or (v_now = '구매 완료' and p_stage in ('수령', '승인'))
    or (v_now = '수령' and p_stage = '구매 완료')
  ) then
    raise exception '% 상태에서는 %(으)로 바꿀 수 없어요.', v_now, p_stage;
  end if;
  update public.purchase_requests set
    status       = p_stage,
    purchased_at = case when p_stage = '승인' then null when p_stage = '구매 완료' and v_now = '승인' then now() else purchased_at end,
    received_at  = case when p_stage = '수령' then now() when p_stage = '구매 완료' then null else received_at end,
    updated_at   = now()
  where id = p_id;
end;
$$;

create or replace function public.set_total_budget(p_amount int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    raise exception '총예산을 확인해 주세요.';
  end if;
  insert into public.app_settings (key, value) values ('total_budget', to_jsonb(p_amount))
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ---------------------------------------------------------------------
-- 일지 사진 (파일은 사이트에서 Storage 에 먼저 올리고, 여기에 기록해요)
-- ---------------------------------------------------------------------

create or replace function public.add_log_photo(p_log_id bigint, p_path text, p_caption text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  perform private.require_writer();
  if not exists (select 1 from public.activity_logs where id = p_log_id and author_id = auth.uid()) then
    raise exception '내가 쓴 일지에만 사진을 붙일 수 있어요.';
  end if;
  if p_path is null or p_path not like auth.uid()::text || '/' || p_log_id::text || '/%' or p_path like '%..%' then
    raise exception '사진 경로가 올바르지 않아요.';
  end if;
  if (select count(*) from public.log_photos where log_id = p_log_id) >= 6 then
    raise exception '일지 하나에 사진은 6장까지 올릴 수 있어요.';
  end if;
  insert into public.log_photos (log_id, author_id, path, caption)
  values (p_log_id, auth.uid(), p_path, private.clean_text(p_caption, '사진 설명', false, 200))
  returning id into v_id;
  return v_id;
end;
$$;

-- 지운 사진의 경로를 돌려줘요. 사이트가 그 경로로 Storage 파일도 지워요.
create or replace function public.delete_log_photo(p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_path text;
begin
  delete from public.log_photos where id = p_id and author_id = auth.uid() returning path into v_path;
  if v_path is null then
    raise exception '내가 올린 사진만 지울 수 있어요.';
  end if;
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.save_notice(bigint, jsonb)               from public, anon;
revoke execute on function public.delete_notice(bigint)                    from public, anon;
revoke execute on function public.save_task(bigint, jsonb)                 from public, anon;
revoke execute on function public.delete_task(bigint)                      from public, anon;
revoke execute on function public.set_task_status(bigint, text)            from public, anon;
revoke execute on function public.save_purchase(bigint, jsonb)             from public, anon;
revoke execute on function public.delete_purchase(bigint)                  from public, anon;
revoke execute on function public.decide_purchase(bigint, boolean, text)   from public, anon;
revoke execute on function public.set_purchase_stage(bigint, text)         from public, anon;
revoke execute on function public.set_total_budget(int)                    from public, anon;
revoke execute on function public.add_log_photo(bigint, text, text)        from public, anon;
revoke execute on function public.delete_log_photo(bigint)                 from public, anon;

grant execute on function public.save_notice(bigint, jsonb)               to authenticated;
grant execute on function public.delete_notice(bigint)                    to authenticated;
grant execute on function public.save_task(bigint, jsonb)                 to authenticated;
grant execute on function public.delete_task(bigint)                      to authenticated;
grant execute on function public.set_task_status(bigint, text)            to authenticated;
grant execute on function public.save_purchase(bigint, jsonb)             to authenticated;
grant execute on function public.delete_purchase(bigint)                  to authenticated;
grant execute on function public.decide_purchase(bigint, boolean, text)   to authenticated;
grant execute on function public.set_purchase_stage(bigint, text)         to authenticated;
grant execute on function public.set_total_budget(int)                    to authenticated;
grant execute on function public.add_log_photo(bigint, text, text)        to authenticated;
grant execute on function public.delete_log_photo(bigint)                 to authenticated;

-- 확인: 표 5개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('app_settings', 'notices', 'tasks', 'purchase_requests', 'log_photos')
order by 1;
