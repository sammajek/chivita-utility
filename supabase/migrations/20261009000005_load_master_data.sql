-- Loader for master data produced by scripts/build_seed.py
-- (seed_data/master_data.json). Key-based and idempotent: re-running it adds
-- anything new but never overwrites edits made on the admin screens.
-- Any top-level key may be omitted, so the data can be loaded in parts.

alter table public.register_sections add constraint register_sections_register_sort_key unique (register_id, sort);
alter table public.register_fields add constraint register_fields_section_sort_key unique (section_id, sort);

create or replace function public.load_master_data(data jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c        jsonb;
  a        jsonb;
  p        jsonb;
  r        jsonb;
  s        jsonb;
  f        jsonb;
  i        int;
  si       int;
  fi       int;
  v_asset  uuid;
  v_reg    uuid;
  v_sec    uuid;
  n_assets int := 0; n_params int := 0; n_regs int := 0; n_fields int := 0;
begin
  i := 0;
  for c in select * from jsonb_array_elements(coalesce(data -> 'categories', '[]')) loop
    insert into asset_categories (name, sort) values (c #>> '{}', i)
    on conflict (name) do update set sort = excluded.sort;
    i := i + 1;
  end loop;

  for a in select * from jsonb_array_elements(coalesce(data -> 'assets', '[]')) loop
    insert into assets (code, name, category_id, area, make, confirmed, notes)
    values (a ->> 'code', a ->> 'name',
            (select id from asset_categories where name = a ->> 'category'),
            (a ->> 'area')::area_code, a ->> 'make', coalesce((a ->> 'confirmed')::boolean, false), a ->> 'notes')
    on conflict (code) do nothing;
    select id into v_asset from assets where code = a ->> 'code';
    insert into asset_aliases (asset_id, alias, source, confirmed)
    select v_asset, al ->> 1, al ->> 0, (al ->> 0) = 'downtime_template'
      from jsonb_array_elements(coalesce(a -> 'aliases', '[]')) al
    on conflict (source, alias) do nothing;
    n_assets := n_assets + 1;
  end loop;

  i := 0;
  for p in select * from jsonb_array_elements(coalesce(data -> 'parameters', '[]')) loop
    insert into parameters (equipment_group, name, unit, data_type, options, ok_options, std_min, std_max,
                            standard_as_written, standard_source, alt_standard, needs_review, review_note, is_counter, sort)
    values (p ->> 'group', p ->> 'name', p ->> 'unit', coalesce(p ->> 'type', 'number')::param_type,
            (select array_agg(x) from jsonb_array_elements_text(p -> 'options') x),
            (select array_agg(x) from jsonb_array_elements_text(p -> 'ok') x),
            (p ->> 'min')::numeric, (p ->> 'max')::numeric, p ->> 'written', p ->> 'source', p ->> 'alt',
            coalesce((p ->> 'review')::boolean, false), p ->> 'note', coalesce((p ->> 'counter')::boolean, false),
            coalesce((p ->> 'sort')::int, i))
    on conflict (equipment_group, name) do nothing;
    i := i + 1;
    n_params := n_params + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(data -> 'registers', '[]')) loop
    insert into registers (key, area, document_no, title, source_sheet, description, sort)
    values (r ->> 'key', (r ->> 'area')::area_code, r ->> 'doc', r ->> 'title', r ->> 'sheet', r ->> 'description',
            coalesce((r ->> 'sort')::int, 0))
    on conflict (key) do nothing;
    select id into v_reg from registers where key = r ->> 'key';

    i := 0;
    for a in select * from jsonb_array_elements(coalesce(r -> 'assets', '[]')) loop
      insert into register_assets (register_id, asset_id, sort)
      values (v_reg, (select id from assets where code = a #>> '{}'), i)
      on conflict do nothing;
      i := i + 1;
    end loop;

    si := 0;
    for s in select * from jsonb_array_elements(coalesce(r -> 'sections', '[]')) loop
      insert into register_sections (register_id, title, slot_kind, slot_times, sort)
      values (v_reg, s ->> 'title', (s ->> 'kind')::slot_kind,
              (select array_agg(x::time) from jsonb_array_elements_text(s -> 'times') x), si)
      on conflict (register_id, sort) do nothing;
      select id into v_sec from register_sections where register_id = v_reg and sort = si;

      fi := 0;
      for f in select * from jsonb_array_elements(coalesce(s -> 'fields', '[]')) loop
        insert into register_fields (section_id, parameter_id, asset_id, label, sort)
        values (v_sec,
                (select id from parameters where equipment_group = f ->> 1 and name = f ->> 2),
                (select id from assets where code = f ->> 3),
                f ->> 0, fi)
        on conflict (section_id, sort) do nothing;
        fi := fi + 1;
        n_fields := n_fields + 1;
      end loop;
      si := si + 1;
    end loop;
    n_regs := n_regs + 1;
  end loop;

  return jsonb_build_object('assets', n_assets, 'parameters', n_params, 'registers', n_regs, 'fields', n_fields);
end;
$$;

revoke execute on function public.load_master_data(jsonb) from public, anon, authenticated;
