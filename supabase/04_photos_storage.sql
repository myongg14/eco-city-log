-- =====================================================================
-- 에코시티 기록 사이트 · 사진 파일 저장소 (Storage 버킷 photos)
-- 03_team_supplies.sql 을 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 사진은 공개되지 않고, 로그인한 사람만 볼 수 있어요. 한 장 최대 3MB (사이트가 올리기 전에 줄여요).
-- =====================================================================

-- 로그인한 사람만 보고, 내 폴더(user_id)에만 올리고 지울 수 있어요.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_active_member());

drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.my_role() = 'student'
    and public.is_active_member()
  );

drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 확인: photos 가 나오면 성공
select id as "만들어진 사진 저장소", public as "공개 여부" from storage.buckets where id = 'photos';
