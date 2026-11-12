-- Shift handover for the whole team (owner, 2026-11-12):
--  * one handover per shift (date + day/night), covering everyone on duty in that shift (all their areas);
--    anyone on the shift can write it; the others then check out "covered by the shift handover";
--  * people on the same shift can add a note to it;
--  * anyone on duty in the NEXT shift acknowledges it (each acknowledgement is recorded; the first one counts as received);
--  * flags: no handover 30 min after a shift with people on duty ended; handover not acknowledged 1 h into the next shift.

alter table public.handovers add column on_duty uuid[] not null default '{}';
create unique index handovers_one_per_shift on public.handovers (shift_date, shift) where not is_demo;

create table public.handover_notes (
  id               uuid primary key default gen_random_uuid(),
  handover_id      uuid not null references public.handovers (id),
  kind             text not null check (kind in ('ack', 'addendum')),
  note             text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  is_demo          boolean not null default false
);
create index handover_notes_idx on public.handover_notes (handover_id, recorded_at);
create unique index handover_notes_one_ack on public.handover_notes (handover_id, recorded_by_id) where kind = 'ack';
create trigger handover_notes_stamp before insert on public.handover_notes for each row execute function public.stamp_recorded();
select public.enable_audit('public.handover_notes', false);

create or replace function public.next_shift_of(p_date date, p_shift text, out shift_date date, out shift text)
language sql
immutable
as $$
  select case when p_shift = 'day' then p_date else p_date + 1 end, case when p_shift = 'day' then 'night' else 'day' end;
$$;

-- Write the shift's handover (once per shift) and check the writer out.
create or replace function public.submit_handover(p_content jsonb, p_footnote text, p_summary text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.duty_sessions; h uuid; n_open int; items jsonb; unanswered int; v_areas public.area_code[]; v_team uuid[]; who text;
begin
  select * into r from duty_sessions where profile_id = auth.uid() and checked_out_at is null order by checked_in_at desc limit 1;
  if r.id is null then raise exception 'You are not checked in.' using errcode = 'P0001'; end if;
  select p.full_name into who from handovers x join profiles p on p.id = x.recorded_by_id
   where x.shift_date = r.shift_date and x.shift = r.shift and not x.is_demo;
  if who is not null then
    raise exception 'The handover for this shift was already written by %. Add a note to it or check out.', who using errcode = 'P0001';
  end if;
  items := coalesce((select value from app_settings where key = 'handover_checklist'), '[]'::jsonb);
  select count(*) into unanswered from jsonb_array_elements_text(items) i
   where coalesce(p_content #>> array['checklist', i, 'answer'], '') not in ('yes', 'no', 'na');
  if unanswered > 0 then raise exception 'Answer every checklist item (% left).', unanswered using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i
              where p_content #>> array['checklist', i, 'answer'] = 'no'
                and coalesce(length(trim(p_content #>> array['checklist', i, 'note'])), 0) < 3) then
    raise exception 'Add a note for every checklist item answered "No".' using errcode = 'P0001';
  end if;
  select array_agg(distinct a order by a), array_agg(distinct s.profile_id)
    into v_areas, v_team
    from duty_sessions s cross join unnest(s.areas) a
   where s.shift_date = r.shift_date and s.shift = r.shift and not s.is_demo;
  select count(*) into n_open from flags where resolved_at is null and (area is null or area = any (v_areas));
  insert into handovers (duty_session_id, shift_date, shift, areas, on_duty, content, footnote, open_flags, recorded_by_type, reading_for)
  values (r.id, r.shift_date, r.shift, v_areas, v_team, p_content, nullif(trim(p_footnote), ''), n_open, 'person', now())
  returning id into h;
  update flags set resolved_at = now(), resolution_note = 'Handover written'
   where ref_key = 'handover-missing:' || r.shift_date || ':' || r.shift and resolved_at is null;
  perform public.check_out(trim('Handover report submitted. ' || coalesce(p_summary, '')));
  return h;
end;
$$;
revoke execute on function public.submit_handover(jsonb, text, text) from public, anon;

-- Someone else on the shift checks out once the shift's handover exists.
create or replace function public.check_out_covered()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.duty_sessions; h public.handovers; who text;
begin
  select * into r from duty_sessions where profile_id = auth.uid() and checked_out_at is null order by checked_in_at desc limit 1;
  if r.id is null then raise exception 'You are not checked in.' using errcode = 'P0001'; end if;
  select * into h from handovers where shift_date = r.shift_date and shift = r.shift and not is_demo;
  if h.id is null then raise exception 'Nobody has written this shift''s handover yet. Write it first.' using errcode = 'P0001'; end if;
  select full_name into who from profiles where id = h.recorded_by_id;
  perform public.check_out(format('Covered by the shift handover written by %s.', who));
  if not (auth.uid() = any (h.on_duty)) then
    update handovers set on_duty = on_duty || auth.uid() where id = h.id;
  end if;
  return h.id;
end;
$$;
revoke execute on function public.check_out_covered() from public, anon;

-- A note added by someone on the same shift.
create or replace function public.add_handover_note(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h public.handovers;
begin
  select * into h from handovers where id = p_id;
  if h.id is null then raise exception 'Handover not found.' using errcode = 'P0001'; end if;
  if not exists (select 1 from duty_sessions where profile_id = auth.uid() and shift_date = h.shift_date and shift = h.shift) then
    raise exception 'Only people on duty in that shift can add to its handover.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Write the note (5+ characters).' using errcode = 'P0001'; end if;
  insert into handover_notes (handover_id, kind, note, recorded_by_type, reading_for) values (p_id, 'addendum', trim(p_note), 'person', now());
end;
$$;
revoke execute on function public.add_handover_note(uuid, text) from public, anon;

-- Anyone on duty in the next shift acknowledges the previous shift's handover.
create or replace function public.receive_handover(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h public.handovers; nx record;
begin
  select * into h from handovers where id = p_id;
  if h.id is null then raise exception 'Handover not found.' using errcode = 'P0001'; end if;
  select * into nx from public.next_shift_of(h.shift_date, h.shift);
  if not exists (select 1 from duty_sessions where profile_id = auth.uid() and shift_date = nx.shift_date and shift = nx.shift) then
    raise exception 'Only someone on duty in the next shift (% %) can acknowledge this handover. Check in first.', nx.shift, nx.shift_date
      using errcode = 'P0001';
  end if;
  if exists (select 1 from handover_notes where handover_id = p_id and kind = 'ack' and recorded_by_id = auth.uid()) then
    raise exception 'You have already acknowledged it.' using errcode = 'P0001';
  end if;
  insert into handover_notes (handover_id, kind, note, recorded_by_type, reading_for) values (p_id, 'ack', nullif(trim(p_note), ''), 'person', now());
  if h.received_at is null then
    perform public.set_change_reason('Handover received');
    update handovers set received_by = auth.uid(), received_at = now(), received_note = nullif(trim(p_note), '') where id = p_id;
  end if;
  update flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'Handover acknowledged'
   where ref_key = 'handover-unack:' || p_id and resolved_at is null;
end;
$$;
revoke execute on function public.receive_handover(uuid, text) from public, anon;

alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due', 'training_unconfirmed', 'patrol_missed', 'patrol_issue',
  'handover_missing', 'handover_unack'));

create or replace function public.run_handover_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int; m int;
begin
  -- shifts (last 2 days) with people on duty, ended 30+ min ago, without a handover
  insert into flags (ref_key, kind, severity, area, title, detail, due_at)
  select 'handover-missing:' || s.shift_date || ':' || s.shift, 'handover_missing', 'warning', null,
         format('No handover written for the %s shift %s', s.shift, s.shift_date),
         'Someone on that shift must write the handover report.', s.ends
    from (select ds.shift_date, ds.shift,
                 public.lagos_ts(ds.shift_date, case ds.shift when 'day' then time '07:00' else time '19:00' end) + interval '12 hours' as ends
            from duty_sessions ds
           where not ds.is_demo and ds.shift_date >= public.log_date_of(now()) - 2
           group by ds.shift_date, ds.shift) s
   where now() > s.ends + interval '30 minutes'
     and not exists (select 1 from handovers h where h.shift_date = s.shift_date and h.shift = s.shift)
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;
  -- handovers not acknowledged 1 h after the next shift started
  insert into flags (ref_key, kind, severity, area, title, detail, due_at)
  select 'handover-unack:' || h.id, 'handover_unack', 'warning', null,
         format('Handover of the %s shift %s not acknowledged', h.shift, h.shift_date),
         'Someone on the next shift must read and acknowledge it (Handover page).', nx_start + interval '1 hour'
    from handovers h
    cross join lateral public.next_shift_of(h.shift_date, h.shift) nx
    cross join lateral (select public.lagos_ts(nx.shift_date, case nx.shift when 'day' then time '07:00' else time '19:00' end) as nx_start) t
   where not h.is_demo and h.received_at is null and h.shift_date >= public.log_date_of(now()) - 2
     and now() > nx_start + interval '1 hour'
  on conflict (ref_key) do nothing;
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.run_handover_flags() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_training_flags(); select public.run_patrol_flags(); select public.run_handover_flags(); select public.run_deck_schedules(); select public.run_flag_job()');
  end if;
end $$;

alter table public.handover_notes enable row level security;
revoke all on public.handover_notes from anon;
create policy handover_notes_read on public.handover_notes for select to authenticated using (public.is_active_user());
-- written through add_handover_note / receive_handover
