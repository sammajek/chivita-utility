-- 1. Register section titles: the casing step in 20261112000046 (first version) dropped words that already began with a
--    capital letter. Restore the titles from the audit trail, then apply the corrected rule (no-op on fresh databases).
-- 2. Patrol points can be outside Utility 1 / 2: area is optional and a free area name can be given (e.g. "Tank farm").

update public.register_sections s
   set title = a.old_data->>'title'
  from public.audit_log a
 where a.table_name = 'register_sections' and a.action = 'update' and a.record_id = s.id::text
   and a.reason = 'Equipment list corrections by the section manager (2026-11-12)'
   and a.old_data->>'title' is distinct from a.new_data->>'title';

update public.register_sections s
   set title = (select string_agg(case when w in ('&', 'and', 'of', 'to') or wm is null then w
                                       else coalesce(wm[1], '') || upper(wm[2]) || wm[3] end, ' ' order by i)
                  from regexp_split_to_table(s.title, ' ') with ordinality t(w, i)
                  cross join lateral (select regexp_match(w, '^([0-9]+-)?([a-z])(.*)$') as wm) x)
 where s.title ~ '(^| |-)[a-z]';

alter table public.patrol_points alter column area drop not null;
alter table public.patrol_points add column if not exists area_label text;
alter table public.patrol_points add constraint patrol_points_area_given check (area is not null or length(trim(area_label)) >= 2);
grant select (area_label) on public.patrol_points to authenticated;
