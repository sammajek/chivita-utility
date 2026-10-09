-- Pick-lists from the 603-001 Utility Downtime Analysis Template (seed_data/downtime_master_lists.json).
create table public.lists (
  list_name text not null,
  value     text not null,
  parent    text,
  sort      integer not null default 0,
  active    boolean not null default true,
  primary key (list_name, value)
);

alter table public.lists enable row level security;
create policy lists_read on public.lists for select to authenticated using (true);
create policy lists_admin_write on public.lists for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));
revoke all on public.lists from anon;

-- simple lists: {list_name: [values...]}
insert into public.lists (list_name, value, sort)
select l.key, v.value, v.ord
  from jsonb_each('{"issue_description":["Equipment failed to start","Equipment tripped during operation","Equipment shut down on alarm","Fault code displayed on HMI / panel","Abnormal noise observed","Excessive vibration observed","Overheating observed","Leakage observed","Low output pressure","Low output flow","High discharge temperature","Pressure fluctuation","Flow fluctuation","Loss of power to equipment","Motor overload trip","Emergency stop activated","Low water level alarm","High water level alarm","Water carryover observed","Foaming in boiler observed","Low steam pressure","Steam leakage observed","Condensate not returning","Compressed air pressure below set point","Moisture in compressed air line","Dew point out of specification","Chilled water temperature above set point","Refrigerant low pressure alarm","Cooling tower fan not running","Poor water quality at outlet","High conductivity / TDS at outlet","Turbidity above limit","UV lamp failure alarm","Filter differential pressure high","Pump not priming / loss of suction","Pump running dry","Borehole yield dropped","Tank level low","Tank overflow","Scheduled maintenance carried out","Statutory inspection carried out","Equipment isolated for repairs","Equipment on standby (not required)","Equipment awaiting spare parts","Equipment awaiting vendor attention","Other (describe in Remarks)"],"downtime_type":["Unplanned Breakdown","Planned Maintenance","External Supply Failure","Idle / Standby"],"attended_by":["Utility Section (In-house)","Electrical & Instrumentation Section","Automation Section","R&A Section","General Workshop","External Vendor"],"production_impact":["Full Stoppage","Partial / Reduced Output","Standby Unit Took Over","No Production Impact"],"downtime_status":["Open","In Progress","Awaiting Spares","Awaiting CAPEX Approval","Awaiting Vendor","Closed"],"category_6m":["Man (people / skill / manning)","Machine (equipment / design)","Material (spares / consumables / water quality)","Method (procedure / practice)","Measurement (instrumentation / calibration)","Environment (external / ambient / supply)"],"action_type":["Immediate Fix Only","Repair + Procedure Change","Preventive Maintenance Revision","Spare Parts Stocking","Training / Competence","Equipment Modification","CAPEX - New Equipment","CAPEX - Equipment Upgrade","Vendor / Contract Change"],"rca_status":["Not Started","Investigation Ongoing","Root Cause Identified","Action In Progress","Awaiting CAPEX Approval","Completed - Pending Verification","Closed - Verified Effective"]}'::jsonb) l,
       jsonb_array_elements_text(l.value) with ordinality v(value, ord)
on conflict do nothing;

-- failure categories and their failure modes: {category: [modes...]}
with c as (
  select key, value, ord from jsonb_each('{"Mechanical":["Bearing failure","Mechanical seal / gasket leakage","Coupling failure","Impeller / rotor damage","Belt failure or slippage","Valve failure (passing / stuck)","Pipe or line leakage","Excessive vibration / misalignment","Tube leakage","Fan / blower fault","Gearbox fault","General mechanical wear","Lubrication failure"],"Electrical":["Motor failure / burnt winding","Public power (PHCN) outage","Generator changeover failure","Contactor / relay fault","Cable or wiring fault","VFD / soft starter fault","Overload trip","Panel / circuit breaker fault","Earth fault","Capacitor / power factor fault","Voltage fluctuation"],"Instrumentation and Control":["Sensor / transmitter fault","PLC or controller fault","HMI / display fault","Pressure switch fault","Level control fault","Temperature control fault","Solenoid valve fault","Calibration drift","Communication / signal loss","Flow meter fault","Safety interlock trip"],"Process and Utility":["Low feed water supply","Poor raw water quality","High conductivity / TDS","Steam pressure drop","Low condensate return","Refrigerant loss / low charge","Low chilled water flow","Compressed air pressure drop","Fouling / scaling","Chemical dosing failure","Cooling tower fouling","Air / gas locking","Resin exhaustion","Membrane fouling"],"Operational":["Operator error","Delayed start-up / shutdown","Improper changeover","Delayed response to alarm","Manpower shortage","Wrong parameter setting"],"Maintenance and Spares":["Spare parts unavailable","Awaiting vendor / OEM support","Awaiting CAPEX approval","Extended repair duration","Repeat failure / poor previous repair","Tooling unavailable"],"Planned Maintenance":["Planned preventive maintenance","Statutory / insurance inspection","Boiler chemical cleaning / blowdown","Descaling / de-fouling","Major overhaul","Plant-wide shutdown","Installation / upgrade project","Calibration exercise"],"External Factors":["Utility supply failure","LPFO / gas supply shortage","Diesel supply shortage","Weather / environmental event","Vendor / contractor delay","Production hold (no demand)"]}'::jsonb) with ordinality t(key, value, ord)
)
insert into public.lists (list_name, value, parent, sort)
select 'failure_category', c.key, null, c.ord from c
union all
select 'failure_mode', m.value, c.key, (c.ord * 100 + m.ord)::int
  from c, jsonb_array_elements_text(c.value) with ordinality m(value, ord)
on conflict do nothing;
