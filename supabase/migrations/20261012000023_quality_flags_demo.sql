-- Water results at/over the alert limit or out of spec, and calibration due soon / overdue.
create or replace function public.run_quality_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  warn_days int := public.setting_num('calibration_warn_days', 30)::int;
  today date := public.lagos_now()::date;
  n int := 0; m int := 0;
begin
  insert into public.flags (ref_key, kind, severity, water_result_id, title, detail, due_at, is_demo)
  select 'water:' || r.id, case r.status when 'action' then 'water_action' else 'water_alert' end,
         case r.status when 'action' then 'critical' else 'warning' end, r.id,
         format('Water %s: %s – %s = %s %s', case r.status when 'action' then 'out of spec' else 'alert' end,
                t.sampling_point, t.parameter, coalesce(r.value_num::text, r.value_text), coalesce(t.unit, '')),
         format('Spec %s; alert %s. Comment: %s', coalesce(t.spec_text, '—'), coalesce(t.alert_text, '—'),
                coalesce(r.comment, r.action_taken, '—')),
         r.reading_for, r.is_demo
    from public.water_results r join public.water_tests t on t.id = r.test_id
   where r.status in ('alert', 'action') and r.voided_at is null and r.recorded_at > now() - interval '7 days'
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;

  -- one flag per instrument per due date; resolved automatically once it is calibrated again
  insert into public.flags (ref_key, kind, severity, area, asset_id, instrument_id, title, detail, due_at, is_demo)
  select 'cal:' || i.id || ':' || i.next_due, 'calibration_due',
         case when i.next_due < today then 'warning' else 'info' end, i.area, i.asset_id, i.id,
         format('Calibration %s: %s %s (due %s)', case when i.next_due < today then 'overdue' else 'due soon' end,
                i.tag, i.description, to_char(i.next_due, 'DD Mon YYYY')),
         i.location, public.lagos_ts(i.next_due, time '00:00'), i.is_demo
    from public.instruments i
   where i.active and i.next_due is not null and i.next_due <= today + warn_days
  on conflict (ref_key) do nothing;
  get diagnostics m = row_count;

  update public.flags f set resolved_at = now(), resolution_note = 'Instrument calibrated'
   where f.kind = 'calibration_due' and f.resolved_at is null
     and exists (select 1 from public.instruments i
                  where i.id = f.instrument_id and (i.next_due is null or i.next_due::text <> split_part(f.ref_key, ':', 3)
                                                    or not i.active));
  return n + m;
end;
$$;
revoke execute on function public.run_quality_flags() from public, anon, authenticated;

-- DEMO: 8 weeks of weekly/fortnightly results and recent monthly ones; a few DEMO instruments with calibration history.
create or replace function public.generate_quality_demo(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.lagos_now()::date;
  n_res int; n_ins int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  insert into public.water_results (test_id, sampled_on, value_num, value_text, status, comment, recorded_by_type,
                                    recorded_by_id, recorded_at, reading_for, is_demo)
  select t.id, d, v.val, case when t.is_text then 'Pure, no off-smell or off-taste' end,
         public.water_status(t, v.val),
         case when public.water_status(t, v.val) in ('alert', 'action') then 'DEMO: resampled, sanitisation scheduled' end,
         'person', p_user, public.lagos_ts(d, time '14:00'), public.lagos_ts(d, time '12:00'), true
    from public.water_tests t
    cross join lateral (
      select (today - extract(isodow from today)::int + 2 - 7 * k)::date d   -- Tuesdays
        from generate_series(0, 8) k
    ) days
    cross join lateral (select random() + 0 * extract(day from days.d) r) rr
    cross join lateral (select case
        when t.is_text then null
        when t.spec_min is not null and t.spec_max is not null then
          round((t.spec_min + (t.spec_max - t.spec_min) * (case when rr.r < 0.03 then 1.15 else 0.1 + 0.8 * rr.r end))::numeric, 2)
        when t.spec_max is not null and t.spec_max > 0 then
          round((t.spec_max * (case when rr.r < 0.03 then 1.2 when rr.r < 0.08 then coalesce(t.alert_max / t.spec_max, 0.8) + 0.01
                                    else 0.05 + 0.5 * rr.r end))::numeric, 3)
        when t.spec_max = 0 then 0
        when t.spec_min is not null then round((t.spec_min * (1.1 + rr.r))::numeric, 2)
        else round((10 + 90 * rr.r)::numeric, 1) end as val) v
   where t.active and t.frequency <> 'conditional' and days.d <= today
     and (t.frequency = 'weekly'
          or (t.frequency = 'fortnightly' and (today - days.d) % 14 < 7)
          or (t.frequency = 'monthly' and days.d > today - 35 and extract(day from days.d) <= 7)
          or (t.frequency = 'quarterly' and days.d > today - 14))
  on conflict do nothing;
  get diagnostics n_res = row_count;

  insert into public.instruments (tag, description, instrument_type, asset_id, area, location, range_text, interval_months,
                                  last_calibrated, is_demo)
  select x.tag, x.descr, x.typ, (select id from public.assets where code = x.asset), 'U1', x.loc, x.rng, x.months,
         (today - x.age)::date, true
    from (values
      ('DEMO-PG-BLR01', 'Boiler 1 steam pressure gauge', 'Pressure gauge', 'BLR-01', 'Boiler house', '0–16 bar', 12, 380),
      ('DEMO-PG-BLR02', 'Boiler 2 steam pressure gauge', 'Pressure gauge', 'BLR-02', 'Boiler house', '0–16 bar', 12, 340),
      ('DEMO-PSV-BLR03', 'Boiler 3 safety relief valve', 'Safety relief valve', 'BLR-03', 'Boiler house', 'Set 10.5 bar', 12, 200),
      ('DEMO-FM-TW01', 'Treated water flowmeter', 'Flowmeter', 'PMP-TW', 'WTP', '0–200 m³/h', 12, 90),
      ('DEMO-TT-CHT01', 'Trane chiller 1 leaving water temperature transmitter', 'Temperature transmitter', 'CHT-01', 'Chiller plant', '-10–50 °C', 6, 175),
      ('DEMO-PG-AR01', 'Air receiver pressure gauge', 'Pressure gauge', 'TNK-AR', 'Compressor house', '0–16 bar', 12, 30)
    ) as x(tag, descr, typ, asset, loc, rng, months, age)
  on conflict (tag) do nothing;
  get diagnostics n_ins = row_count;

  insert into public.calibrations (instrument_id, calibrated_on, result, certificate_no, vendor, notes, recorded_by_type,
                                   recorded_by_id, recorded_at, reading_for, is_demo)
  select i.id, i.last_calibrated, 'pass', 'DEMO-CERT-' || right(i.tag, 5), 'DEMO vendor', null, 'person', p_user,
         public.lagos_ts(i.last_calibrated, time '15:00'), public.lagos_ts(i.last_calibrated, time '12:00'), true
    from public.instruments i where i.is_demo and i.last_calibrated is not null
     and not exists (select 1 from public.calibrations c where c.instrument_id = i.id);
  return jsonb_build_object('water_results', n_res, 'instruments', n_ins);
end;
$$;
revoke execute on function public.generate_quality_demo(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_flag_job()');
  end if;
end $$;
