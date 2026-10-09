-- DEMO data generator, so every screen can be reviewed before real data exists.
-- Everything it creates is marked is_demo = true and can be removed with
-- clear_demo_data() (migration 20261009000012). Only admins or the database owner can run them.

create or replace function public.demo_value(p public.parameters, slot_no int)
-- slot_no = hours since 1 Jan 2026 at the slot time
returns table (v_num numeric, v_text text, bad boolean)
language plpgsql
volatile
set search_path = public
as $$
declare
  r      double precision := random();
  lo     numeric;
  hi     numeric;
  base   numeric;
begin
  bad := false;
  if p.data_type = 'select' then
    if p.ok_options is not null and r < 0.03 then
      v_text := (select o from unnest(p.options) o where not (o = any (p.ok_options)) limit 1);
      bad := v_text is not null;
    end if;
    v_text := coalesce(v_text, p.ok_options[1], p.options[1 + (slot_no % cardinality(p.options))]);
    return next; return;
  end if;
  if p.is_counter then
    -- cumulative counters (running hours etc.): ~95% utilisation since 1 Jan 2026
    v_num := round((5000 + slot_no * 0.95)::numeric, 1);
    return next; return;
  end if;
  lo := p.std_min; hi := p.std_max;
  if lo is not null and hi is not null and hi > lo then
    base := lo + (hi - lo) * (0.15 + 0.7 * random());
    if r < 0.04 then base := hi + (hi - lo) * (0.1 + random() * 0.4); bad := true; end if;
  elsif lo is not null and hi is not null then
    base := lo;
  elsif lo is not null then
    base := greatest(lo, 0.1) * (1.05 + random() * 0.25);
    if r < 0.04 then base := lo * 0.8; bad := lo > 0; end if;
  elsif hi is not null then
    base := hi * (0.5 + random() * 0.35);
    if r < 0.04 then base := hi * 1.15 + 0.01; bad := true; end if;
  else
    base := case coalesce(p.unit, '')
      when '°C' then 25 + random() * 20 when 'bar' then 2 + random() * 5 when '%' then 50 + random() * 40
      when 'kPa' then 300 + random() * 600 when 'm³/h' then 20 + random() * 30 when 'mbar' then 20 + random() * 30
      when 'ppm' then 50 + random() * 200 when 'µS/cm' then 300 + random() * 900 when 'kW' then 120 + random() * 60
      when 'Hz' then 45 + random() * 5 when 'TR' then 300 + random() * 150 when 'mmHg' then 4 + random() * 4
      else 5 + random() * 5 end;
  end if;
  v_num := round(base, 2);
  return next;
end;
$$;

revoke execute on function public.demo_value(public.parameters, int) from public, anon, authenticated;
