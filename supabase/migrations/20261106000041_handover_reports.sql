-- Structured shift handover (UTILITY HANDOVER REPORT sheet): per equipment group running / standby / maintenance-faults,
-- fuel usage, fire hydrant, water treatment plant (pumps, pH, raw/treated water levels), borehole, degasser,
-- caustic mixing, footnote, and a short end-of-shift checklist. Submitting it checks the engineer out.
-- The incoming engineer acknowledges receipt; a manager signs it off. Submitted reports cannot be edited.

create table public.handovers (
  id               uuid primary key default gen_random_uuid(),
  duty_session_id  uuid not null unique references public.duty_sessions (id),
  shift_date       date not null,
  shift            text not null check (shift in ('day', 'night')),
  areas            public.area_code[] not null,
  content          jsonb not null,
  footnote         text,
  open_flags       int,
  received_by      uuid references auth.users (id),
  received_at      timestamptz,
  received_note    text,
  manager_by       uuid references auth.users (id),
  manager_at       timestamptz,
  manager_note     text,
  recorded_by_type text not null default 'person' check (recorded_by_type in ('person', 'logger')),
  recorded_by_id   uuid,
  recorded_at      timestamptz not null default now(),
  reading_for      timestamptz,
  is_demo          boolean not null default false
);
create index handovers_shift_idx on public.handovers (shift_date desc, shift);
create trigger handovers_stamp before insert on public.handovers for each row execute function public.stamp_recorded();
select public.enable_audit('public.handovers', false);

-- The checklist items every handover must answer (yes / no + note when "no").
insert into public.app_settings (key, value, description) values
  ('handover_checklist', '["All register readings for my shift are entered", "Out-of-spec values have an action recorded", "Open flags reviewed and passed on", "Downtime events updated (status, end time, follow-up)", "Shift PM tasks recorded (done / not done)", "Area patrol rounds completed", "Work permits closed or handed over", "Control room and plant areas left clean and safe"]'::jsonb,
   'Checklist answered on every shift handover (edit the list here).')
on conflict (key) do nothing;

-- Submit my handover for my open duty session and check out in one step.
create or replace function public.submit_handover(p_content jsonb, p_footnote text, p_summary text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.duty_sessions; h uuid; n_open int; items jsonb; unanswered int;
begin
  select * into r from duty_sessions where profile_id = auth.uid() and checked_out_at is null order by checked_in_at desc limit 1;
  if r.id is null then raise exception 'You are not checked in.' using errcode = 'P0001'; end if;
  items := coalesce((select value from app_settings where key = 'handover_checklist'), '[]'::jsonb);
  select count(*) into unanswered from jsonb_array_elements_text(items) i
   where coalesce(p_content #>> array['checklist', i, 'answer'], '') not in ('yes', 'no', 'na');
  if unanswered > 0 then raise exception 'Answer every checklist item (% left).', unanswered using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i
              where p_content #>> array['checklist', i, 'answer'] = 'no'
                and coalesce(length(trim(p_content #>> array['checklist', i, 'note'])), 0) < 3) then
    raise exception 'Add a note for every checklist item answered "No".' using errcode = 'P0001';
  end if;
  select count(*) into n_open from flags where resolved_at is null and (area is null or area = any (r.areas));
  insert into handovers (duty_session_id, shift_date, shift, areas, content, footnote, open_flags, recorded_by_type, reading_for)
  values (r.id, r.shift_date, r.shift, r.areas, p_content, nullif(trim(p_footnote), ''), n_open, 'person', now())
  returning id into h;
  perform public.check_out(trim('Handover report submitted. ' || coalesce(p_summary, '')));
  return h;
end;
$$;
revoke execute on function public.submit_handover(jsonb, text, text) from public, anon;

-- The incoming engineer confirms they have read the handover.
create or replace function public.receive_handover(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h public.handovers;
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  select * into h from handovers where id = p_id;
  if h.id is null then raise exception 'Handover not found.' using errcode = 'P0001'; end if;
  if h.recorded_by_id = auth.uid() then raise exception 'The incoming engineer acknowledges, not the one handing over.' using errcode = 'P0001'; end if;
  if h.received_at is not null then raise exception 'Already acknowledged.' using errcode = 'P0001'; end if;
  perform public.set_change_reason('Handover received');
  update handovers set received_by = auth.uid(), received_at = now(), received_note = nullif(trim(p_note), '') where id = p_id;
end;
$$;
revoke execute on function public.receive_handover(uuid, text) from public, anon;

create or replace function public.sign_handover(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('shift_manager', 'section_manager', 'admin') then
    raise exception 'Only managers sign handovers.' using errcode = 'P0001';
  end if;
  perform public.set_change_reason('Handover signed by manager');
  update handovers set manager_by = auth.uid(), manager_at = now(), manager_note = nullif(trim(p_note), '')
   where id = p_id and manager_at is null;
  if not found then raise exception 'Handover not found or already signed.' using errcode = 'P0001'; end if;
end;
$$;
revoke execute on function public.sign_handover(uuid, text) from public, anon;

alter table public.handovers enable row level security;
revoke all on public.handovers from anon;
create policy handovers_read on public.handovers for select to authenticated using (public.is_active_user());
-- writes go through submit_handover / receive_handover / sign_handover
