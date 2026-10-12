-- Readings filled from an HMI photo: keep how each value was entered and the photo as evidence.
alter table public.readings add column entry_method text not null default 'manual'
  check (entry_method in ('manual', 'photo', 'logger'));
alter table public.readings add column photo_path text;
comment on column public.readings.entry_method is
  'manual = typed; photo = read from an HMI photo on the phone and confirmed by the person; logger = from a data logger.';
comment on column public.readings.photo_path is 'Path in the private "hmi-photos" storage bucket.';

-- Private storage bucket (Supabase only; skipped on the local test database).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hmi-photos', 'hmi-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy hmi_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'hmi-photos' and (storage.foldername(name))[1] = auth.uid()::text
                  and public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin'))$p$;
    execute $p$create policy hmi_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'hmi-photos')$p$;
  end if;
end $$;
