-- Приватный бакет для документов студентов (справка о месте учёбы, согласие родителя).
insert into storage.buckets (id, name, public)
values ('student-docs', 'student-docs', false)
on conflict (id) do nothing;

-- RLS на storage.objects: пользователь работает только со своей папкой <uid>/...
-- (Service role в Edge Function обходит RLS и создаёт signed URL для проверки.)

drop policy if exists "student_docs_insert_own" on storage.objects;
create policy "student_docs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'student-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "student_docs_update_own" on storage.objects;
create policy "student_docs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'student-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "student_docs_select_own" on storage.objects;
create policy "student_docs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-docs' and (storage.foldername(name))[1] = auth.uid()::text);
