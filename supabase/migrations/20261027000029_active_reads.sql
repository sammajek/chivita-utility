-- Only ACTIVE users can read plant data. Before this, a person who signed up with "Request access"
-- could read (not change) records while waiting for approval. Inactive users still see their own profile,
-- so the app can show "your account is not active yet".
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;
revoke execute on function public.is_active_user() from public, anon;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'SELECT' and qual = 'true' and 'authenticated' = any (roles)
       and tablename <> 'profiles'
  loop
    execute format('alter policy %I on %I.%I using (public.is_active_user())', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter policy profiles_read on public.profiles using (id = auth.uid() or public.is_active_user());

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'hmi_photos_read') then
    execute $p$alter policy hmi_photos_read on storage.objects using (bucket_id = 'hmi-photos' and public.is_active_user())$p$;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'evidence_read') then
    execute $p$alter policy evidence_read on storage.objects using (bucket_id = 'evidence' and public.is_active_user())$p$;
  end if;
end $$;
