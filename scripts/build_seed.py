#!/usr/bin/env python3
"""Build seed_data/master_data.json and supabase/seed/10_master_data.sql from seed_data/ and the register
layouts in source_files/REGISTERS_UTILITY_1/2.xlsx.

The register definitions below were transcribed from the paper/Excel log
sheets: same document numbers, titles, parameters, reading times and pass/fail
choices. Standards come from seed_data/equipment_standards.csv (the
"Utility Equipment Standard" sheet). Where a register prints a different
standard, it is kept in parameters.alt_standard and flagged needs_review.

The output is key-based JSON (asset codes, parameter group+name, register keys)
loaded by public.load_master_data(), so re-running the import updates in place.

Usage:  python3 scripts/build_seed.py
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------
CATEGORIES = [
    "Boilers", "Air Compressors", "Air Dryers", "Degassers", "Chillers", "Jet Pumps", "Boreholes",
    "UV Systems", "Filtration", "Pumps", "Water Treatment", "Storage Tanks", "Distribution Systems",
    "Nitrogen Generators", "General",
]

# code, name, category, area, make, confirmed, notes, aliases[(source, alias)]
ASSETS: list[tuple] = []


def asset(code, name, cat, area="U1", make=None, confirmed=True, notes=None, aliases=()):
    ASSETS.append((code, name, cat, area, make, confirmed, notes, list(aliases)))


DT = "downtime_template"
PM = "pm_register"
RG = "log_register"

# Downtime template names are the canonical names (confirmed=True means "seen in
# the downtime template"); extras from other files are unconfirmed until the
# owner checks them.
asset("BLR-01", "Boiler 1 (LOOS)", "Boilers", make="LOOS", aliases=[(DT, "Boiler 1 (LOOS)"), (PM, "STEAM BOILER 1")])
asset("BLR-02", "Boiler 2 (SHELLMAX)", "Boilers", make="SHELLMAX", aliases=[(DT, "Boiler 2 (SHELLMAX)"), (PM, "STEAM BOILER 2")])
asset("BLR-03", "Boiler 3 (THERMAX)", "Boilers", make="THERMAX", aliases=[(DT, "Boiler 3 (THERMAX)"), (PM, "STEAM BOILER 3")])
asset("BLR-04", "Boiler 4 (THERMAX)", "Boilers", make="THERMAX",
      notes="PM register calls it THERMAX EXHAUST BOILER 4. Same unit as the 3.5 t/h waste heat boiler? (owner to confirm)",
      aliases=[(DT, "Boiler 4 (THERMAX)"), (PM, "THERMAX EXHAUST BOILER 4")])
asset("BLR-05", "Boiler 5 (THERMAX)", "Boilers", make="THERMAX", aliases=[(DT, "Boiler 5 (THERMAX)"), (PM, "STEAM BOILER 5")])
asset("BLR-06", "2 t/h Boiler", "Boilers", area="U2", confirmed=False,
      notes="Utility 2 register '2 TONS/HR BOILER LOG REPORT'.", aliases=[(RG, "2 TONS/HR BOILER")])
asset("BLR-07", "3.5 t/h Waste Heat Boiler", "Boilers", area="U2", confirmed=False,
      notes="Utility 2 register '3.5 TONS/HR WASTE HEAT BOILER LOG REPORT'. May be the same as BLR-04.",
      aliases=[(RG, "3.5 TONS/HR WASTE HEAT BOILER")])

for n, kind in [(2, "Oil"), (3, "Oil-free"), (4, "Oil-free"), (5, "Oil-free"), (6, "Oil-free"), (7, "Oil-free"),
                (8, "Oil-free"), (9, "Oil-free"), (11, "Oil"), (12, "Oil")]:
    pm_kind = "NORMAL" if kind == "Oil" else "OIL-FREE"
    asset(f"CMP-{n:02d}", f"Air Compressor {n} - {kind} (Ingersoll Rand)", "Air Compressors", make="Ingersoll Rand",
          aliases=[(DT, f"Air Compressor {n} - {kind} (Ingersoll Rand)"), (PM, f"AIR COMPRESSOR NO.{n} ({pm_kind})")])
asset("CMP-10", "Air Compressor 10 - Oil-free (Ingersoll Rand)", "Air Compressors", make="Ingersoll Rand", confirmed=False,
      notes="In the PM register but not in the downtime template.", aliases=[(PM, "AIR COMPRESSOR NO.10 (OIL-FREE)")])
asset("CMP-13", "Air Compressor IR MH75", "Air Compressors", area="U2", make="Ingersoll Rand", confirmed=False,
      notes="Utility 2 register 'IR MH75 AIR COMPRESSOR LOG REPORT'.", aliases=[(RG, "IR MH75 AIR COMPRESSOR")])

for n in range(1, 11):
    asset(f"DRY-{n:02d}", f"Air Dryer {n}", "Air Dryers", make="Atlas Copco" if n == 9 else "Ingersoll Rand",
          aliases=[(DT, f"Air Dryer {n}"), (PM, f"REFRIGERATED AIR DRYER NO.{n}")])
asset("DRY-11", "Air Dryer 11", "Air Dryers", make="Ingersoll Rand", confirmed=False,
      notes="Listed on the U1 IR dryer register ('for No. 5, 6, 7, 8, 10, 11') but not in the downtime template.")
asset("DRY-12", "Air Dryer IR TMS", "Air Dryers", area="U2", make="Ingersoll Rand", confirmed=False,
      notes="Utility 2 register 'IR TMS AIR DRYER LOG REPORT'.", aliases=[(RG, "IR TMS AIR DRYER")])

for n in range(1, 4):
    asset(f"DGS-{n:02d}", f"Degasser {n}", "Degassers", aliases=[(DT, f"Degasser {n}")])

for n in range(1, 6):
    asset(f"CHT-{n:02d}", f"TRANE Chiller {n} + Cooling Tower", "Chillers", make="Trane",
          aliases=[(DT, f"TRANE Chiller {n} + Cooling Tower"), (PM, f"TRANE CHILLER {n}"), (PM, f"TRANE COOLING TOWER {n}")])
for n in range(1, 5):
    asset(f"CHV-{n:02d}", f"VAM Chiller {n} + Cooling Tower", "Chillers", make="Thermax",
          aliases=[(DT, f"VAM Chiller {n} + Cooling Tower"), (PM, f"VAM CHILLER {n}"), (PM, f"VAM COOLING TOWER {n}")])
asset("CHC-01", "Clivet Chiller (air-cooled)", "Chillers", area="U2", make="Clivet", confirmed=False,
      aliases=[(PM, "CLIVET CHILLER - AIR COOLED"), (RG, "CLIVET CHILLER")])
asset("CHK-01", "Carrier Chiller (air-cooled)", "Chillers", area="U2", make="Carrier", confirmed=False,
      aliases=[(PM, "CARRIER CHILLER - AIR COOLED")])
asset("CHV-U2", "VAM Chiller (Utility 2)", "Chillers", area="U2", make="Thermax", confirmed=False,
      notes="Utility 2 'VAM CHILLER LOG REPORT' / 'CHILLER LOGBOOK THERMAX (THDC2)'. Is this one of VAM 1-4?")

for n, loc in enumerate(["Expansion", "New Building", "Old Building 1", "Old Building 2", "Debottleneck"], start=1):
    asset(f"JP-{n:02d}", f"Jet Pumps ({loc})", "Jet Pumps", aliases=[(DT, f"Jet Pumps ({loc})")])
for n in range(1, 8):
    asset(f"BH-{n:02d}", f"Borehole {n}", "Boreholes", aliases=[(DT, f"Borehole {n}")])
for n, letter in enumerate("ABCD", start=1):
    asset(f"UV-{n:02d}", f"UV-{n}", "UV Systems", aliases=[(DT, f"UV-{n}"), (RG, f"UV-{letter}")])
for n in range(1, 8):
    asset(f"PFT-{n:02d}", f"Pressure Filter Tank {n}", "Filtration", confirmed=n <= 5,
          notes=None if n <= 5 else "On the WTP equipment register but not in the downtime template.",
          aliases=[(DT, f"Pressure Filter Tank {n}")] if n <= 5 else [])
asset("FLT-PRE", "Pre-Filter Bag Units", "Filtration", aliases=[(DT, "Pre-Filter Bag"), (PM, "PRESSURE PRE-FILTER BAG TANK 25UM")])
asset("FLT-POST", "Post-Filter Bag Unit", "Filtration", aliases=[(DT, "Post-Filter Bag"), (PM, "PRESSURE POST-FILTER BAG TANK 1UM")])
asset("PMP-RW", "Raw Water Pumps", "Pumps", aliases=[(DT, "Raw Water Pumps")])
asset("PMP-TW", "Treated Water Pumps", "Pumps", aliases=[(DT, "Treated Water Pumps"), (PM, "TREATED WATER TRANSFER PUMPS")])
asset("PMP-CWI", "Chilled Water Inlet Pumps", "Pumps", aliases=[(DT, "Chilled Water Inlet Pumps"), (PM, "CHILLED WATER TRANSFER PUMPS")])
asset("PMP-CWO", "Chilled Water Outlet Pumps", "Pumps", aliases=[(DT, "Chilled Water Outlet Pumps")])
asset("PMP-BFW", "Boiler Feed Water Transfer Pumps", "Pumps", confirmed=False, aliases=[(PM, "BOILER FEED WATER TRANSFER PUMPS")])
asset("RO-01", "RO Plant", "Water Treatment", aliases=[(DT, "RO Plant")])
asset("SOF-01", "Softener Plant", "Water Treatment", confirmed=False, aliases=[(PM, "SOFTENER PLANT")])
asset("TNK-UT", "Utility Tanks (Raw, Treated, Chilled, Boiler Feed, RO Water)", "Storage Tanks",
      aliases=[(DT, "Utility Tanks (Raw Water, Treated Water, Chilled Water, Boiler Feed Water, RO Water)"),
               (PM, "MS TANKS"), (PM, "SS TANKS")])
asset("TNK-AR", "Air Receiver Tanks", "Storage Tanks", aliases=[(DT, "Air Receiver Tanks"), (PM, "AIR RECEIVER TANKS")])
for code, name in [("DST-STM", "Steam Distribution"), ("DST-TW", "Treated Water Distribution"),
                   ("DST-CHW", "Chilled Water Distribution"), ("DST-CND", "Steam Condensate Collection"),
                   ("DST-AIR", "Compressed Air Distribution")]:
    asset(code, name, "Distribution Systems", aliases=[(DT, name)])
for n in range(1, 5):
    asset(f"N2G-{n:02d}", f"Nitrogen Generator {n}", "Nitrogen Generators", confirmed=False,
          notes="From the Utility 1 nitrogen register (generators 1-4).")
for n in range(1, 3):
    asset(f"N2G-U2-{n:02d}", f"Nitrogen Generator {n} (Utility 2)", "Nitrogen Generators", area="U2", confirmed=False,
          notes="From the Utility 2 nitrogen register (generators 1-2).")
asset("SYS-U1", "Utility 1 general plant", "General", notes="Readings on the general registers that are not tied to one machine.")
asset("SYS-U2", "Utility 2 general plant", "General", area="U2", notes="Readings on the general registers that are not tied to one machine.")

# Remaining PM names that need the owner to map them (left unmapped on purpose).
UNMAPPED_PM = ["BH 1,4,5 DEGASSER", "BH 2 DEGASSER", "BH 6, 7 DEGASSER", "BOREHOLES", "FLOWMETERS", "GENERAL",
               "PRESSURE GUAGES", "PRESSURE SAFETY RELIEF VALVES", "STEAM TRAP", "UTILITY DISTRIBUTION LINE"]

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------
STD: dict[tuple[str, str], dict] = {}
with open(ROOT / "seed_data/equipment_standards.csv", newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        STD[(row["equipment_group"], row["parameter"])] = row

PARAMS: dict[tuple[str, str], dict] = {}


def num(v):
    return None if v in ("", None) else float(v)


SELECTS = {
    "leak": (["No Leak", "Leak"], ["No Leak"]),
    "working": (["Working", "Not Working"], ["Working"]),
    "clear": (["Clear", "Not Clear"], ["Clear"]),
    "functional": (["Functional", "Not Functional"], ["Functional"]),
    "clean": (["Clean", "Not Clean"], ["Clean"]),
    "okay": (["Okay", "Not Okay"], ["Okay"]),
    "salt": (["Salt", "No Salt"], ["Salt"]),
    "full": (["Full", "Not Full"], ["Full"]),
    "lnh": (["Low", "Normal", "High"], ["Normal"]),
    "boa": (["Below", "On", "Above"], ["On"]),
    "damage": (["No Damage", "Damage"], ["No Damage"]),
    "pump12": (["1", "2"], None),
    "oneboth": (["One", "Both"], None),
    "level3": (["25%", "50%", "75%"], None),
    "oillevel": (["Below 1/2", "1/2 to 3/4", "Above 3/4"], ["1/2 to 3/4"]),
    "noise": (["Normal", "Abnormal"], ["Normal"]),
    "burner": (["Burner", "Steam"], None),
}


def param(group: str, name: str, unit: str | None = None, *, std: str | None = None, sel: str | None = None,
          mn=None, mx=None, written=None, counter=False, alt=None, review=None, text=False) -> tuple[str, str]:
    """Register a parameter; returns its key. std = parameter name in equipment_standards.csv
    (group defaults to `group`, or 'Group|Name')."""
    key = (group, name)
    if key in PARAMS:
        return key
    p = dict(group=group, name=name, unit=unit, data_type="number", options=None, ok=None, std_min=mn, std_max=mx,
             written=written, source=None, alt=alt, needs_review=False, review=review, counter=counter)
    if sel:
        p["data_type"] = "select"
        p["options"], p["ok"] = SELECTS[sel]
    if text:
        p["data_type"] = "text"
    if std:
        g, n = std.split("|") if "|" in std else (group, std)
        row = STD[(g, n)]
        p.update(std_min=num(row["min"]), std_max=num(row["max"]), written=row["standard_as_written"] or None,
                 source="Utility Equipment Standard sheet")
        if row["needs_review"] == "yes":
            p["needs_review"] = True
            p["review"] = "No limit given on the standard sheet."
    elif mn is not None or mx is not None:
        p["source"] = "Printed on the register"
    if alt:
        p["needs_review"] = True
        p["review"] = (p["review"] + " " if p["review"] else "") + f"Conflicting standard elsewhere: {alt}."
    if review and not alt:
        p["needs_review"] = True
    PARAMS[key] = p
    return key


# ---------------------------------------------------------------------------
# Registers
# ---------------------------------------------------------------------------
HOURLY_U1_WTP = [f"{h:02d}:00" for h in list(range(7, 24)) + list(range(0, 7))]
HOURLY_24_FROM8 = [f"{h:02d}:00" for h in list(range(8, 24)) + list(range(0, 8))]
HOURLY_U2 = [f"{h:02d}:00" for h in list(range(8, 19)) + list(range(20, 24)) + list(range(0, 7))]
SIX_HOURLY = ["09:00", "15:00", "21:00", "03:00"]
THREE_HOURLY_U2 = ["08:00", "11:00", "14:00", "17:00", "20:00", "23:00", "02:00", "05:00"]
TWO_HOURLY_U2 = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "00:00", "02:00", "04:00", "06:00"]

REGISTERS: list[dict] = []


def register(key, area, doc, title, sheet, assets=(), sort=0, description=None):
    r = dict(key=key, area=area, doc=doc, title=title, sheet=sheet, assets=list(assets), sections=[], sort=sort,
             description=description)
    REGISTERS.append(r)
    return r


def section(reg, title, kind, times=None, fields=()):
    """fields: list of (label, param_key) or (label, param_key, asset_code)."""
    reg["sections"].append(dict(title=title, kind=kind, times=times, fields=list(fields)))


# Groups
GU, BW, BL = "General Utility", "Boiler Water", "Boiler"
TR, VM, AIR_IR, AIR_OIL = "Trane Chiller", "VAM Chiller", "Air Compressor IR", "Air Compressor Oil"
DRY_IR, DRY_AC, WT, N2 = "Air Dryer IR", "Air Dryer AC", "Water Treatment", "Nitrogen"

for area in ("U1", "U2"):
    sys_asset = f"SYS-{area}"
    n = 1 if area == "U1" else 2
    # --- General Utility - Hourly (Day High / Day Low) ---------------------
    r = register(f"{area.lower()}-gu-hourly", area, "CHINGRGUT01", "General Utility - Daily High/Low",
                 "General Utility - Hourly", sort=10,
                 description="Daily highest and lowest values (the sheet is titled 'Hourly').")
    section(r, "Boiler water & utility", "daily_high_low", fields=[
        ("Feed Water Tank Level (%)", param(BL, "Feed Water Tank Level", "%", std="Feed Water Tank Level", alt="80 - 90 % (General Utility register)"), sys_asset),
        ("Feed Water Tank Temperature (°C)", param(BL, "Feed Water Tank Temperature", "°C", std="Feed Water Tank Temperature"), sys_asset),
        ("Chilled Water Outlet Temp. (°C)", param(GU, "Chilled Water Outlet Temperature", "°C", std="Outlet Temperature", alt="6 - 10 °C (General Utility register)"), sys_asset),
        ("Air Line Pressure (bar)", param(GU, "Air Line Pressure", "bar", std="Air Line Pressure"), sys_asset),
        ("Steam Line Pressure (bar)", param(GU, "Steam Line Pressure", "bar", std="Steam Line Pressure"), sys_asset),
    ])
    # --- General Utility - Shift & Daily ------------------------------------
    r = register(f"{area.lower()}-gu-shift", area, "CHINGRGUT01", "General Utility - Shift & Daily",
                 "General Utility - Shift & Daily", sort=11)
    pump_p = param(GU, "Chilled Water Pump Pressure", "bar", std="Chilled Water Pump Pressure", alt="3.5 - 4.5 bar (Shift & Daily register)")
    fw = [
        ("Feed Water pH", param(BW, "Feed Water pH", None, std="Boiler|Feed Water pH")),
        ("Feed Water TDS (ppm)", param(BW, "Feed Water TDS", "ppm", mx=2000, written="< 2000",
                                         review="Boiler water TDS standard is < 3500 ppm; is < 2000 the feed water limit?")),
        ("Feed Water Conductivity (µS/cm)", param(BW, "Feed Water Conductivity", "µS/cm", mx=2000, written="< 2000",
                                                    review="Boiler conductivity standard is < 3500 µS/cm; is < 2000 the feed water limit?")),
        ("Feed Water Total Hardness (ppm)", param(BW, "Feed Water Total Hardness", "ppm", mn=0, mx=0, written="0")),
        ("Feed Water P-Alkalinity (ppm)", param(BW, "Feed Water P-Alkalinity", "ppm")),
        ("Feed Water M-Alkalinity (ppm)", param(BW, "Feed Water M-Alkalinity", "ppm")),
        ("Feed Water O-Alkalinity (ppm)", param(BW, "Feed Water O-Alkalinity", "ppm")),
        ("Feed Water Sulphite (ppm)", param(BW, "Feed Water Sulphite", "ppm")),
        ("Feed Water TSS (ppm)", param(BW, "Feed Water TSS", "ppm")),
    ]
    section(r, "Chilled water pumps & feed water", "shift",
            fields=[(f"Chilled Water Pump {i} Pressure (bar)", pump_p, sys_asset) for i in range(1, 13)]
            + [(lbl, k, sys_asset) for lbl, k in fw])

# --- U1 General log report (CHIENGUTRG11) ----------------------------------
r = register("u1-general", "U1", "CHIENGUTRG11", "General Log Report", "General", sort=12)
section(r, "Boiler & chilled water", "time", SIX_HOURLY, [
    ("Feed Water Tank Level (%)", param(BL, "Feed Water Tank Level", "%"), "SYS-U1"),
    ("Feed Water Tank Temp. (°C)", param(BL, "Feed Water Tank Temperature", "°C"), "SYS-U1"),
    ("Chilled Water Tank Level", param(GU, "Chilled Water Tank Level", None, sel="full"), "SYS-U1"),
] + [(f"Chilled Water Pump {i} Pressure (bar)", param(GU, "Chilled Water Pump Pressure", "bar"), "SYS-U1") for i in range(1, 13)])
section(r, "Chemicals, WTP & auxiliaries", "shift", fields=[
    ("Diesel Tank Level (%)", param(BL, "Diesel Tank Level", "%"), "SYS-U1"),
    ("Oxygen Scavenger Chemical Tank Level (%)", param(BL, "Oxygen Scavenger Tank Level", "%"), "SYS-U1"),
    ("Sludge Dispersant Chemical Tank Level (%)", param(BL, "Sludge Dispersant Tank Level", "%"), "SYS-U1"),
    ("Softener Plant Salt Level", param(WT, "Softener Plant Salt Level", None, sel="salt"), "SOF-01"),
    ("Borehole 2 Degasser Blower Operation", param(WT, "Degasser Blower Operation", None, sel="okay"), "DGS-02"),
    ("Utility 1 Degasser Blower Operation", param(WT, "Degasser Blower Operation", None, sel="okay"), "DGS-01"),
    ("Backwashing Transfer Pump Operation", param(WT, "Backwashing Transfer Pump Operation", None, sel="okay"), "SYS-U1"),
    ("NEXGEN Air Blowers Operation", param(WT, "NEXGEN Air Blowers Operation", None, sel="okay"), "SYS-U1"),
    ("Steam Condensate Tank & Pump Operation", param(GU, "Steam Condensate Tank & Pump Operation", None, sel="okay"), "DST-CND"),
    ("Water Recovery Tank & Pump Operation", param(WT, "Water Recovery Tank & Pump Operation", None, sel="okay"), "SYS-U1"),
])

# --- U1 Boiler log (CHIENGUTRG03): boilers 1, 2, 5 --------------------------
r = register("u1-boiler", "U1", "CHIENGUTRG03", "Boiler Log Report", "Boiler", assets=["BLR-01", "BLR-02", "BLR-05"], sort=20)
section(r, "Boiler operation", "time", SIX_HOURLY, [
    ("Steam Pressure (bar)", param(BL, "Steam Pressure", "bar", std="Steam Pressure (bar)")),
    ("Flame Signal (%)", param(BL, "Flame Signal", "%", std="Flame Signal (%)", alt="90 - 95 % (second boiler block on the standard sheet)")),
    ("Conductivity (µS/cm)", param(BL, "Conductivity", "µS/cm", std="Conductivity (us/cm)")),
    ("Water Level (%)", param(BL, "Water Level", "%", mn=60, mx=75, written="60 - 75")),
    ("Flue Gas Temperature (°C)", param(BL, "Flue Gas Temperature", "°C", std="Flue Gas Temperature (°C)")),
    ("Fuel Pump Pressure (bar)", param(BL, "Fuel Pump Pressure", "bar", mn=12, mx=25, written="12 - 25 bar")),
    ("Oil Temperature (°C)", param(BL, "Oil Temperature", "°C", mn=40, mx=75, written="40 - 75 °C")),
    ("Oil Pump Working No 1/2", param(BL, "Oil Pump Working", None, sel="pump12")),
    ("Feedwater Pump Working No 1/2", param(BL, "Feedwater Pump Working", None, sel="pump12")),
])
section(r, "Hours & checks", "shift", fields=[
    ("Feedwater Operating Pump 1 Hours", param(BL, "Feedwater Pump 1 Operating Hours", "h", counter=True)),
    ("Feedwater Operating Pump 2 Hours", param(BL, "Feedwater Pump 2 Operating Hours", "h", counter=True)),
    ("Operating Hours - Gas", param(BL, "Operating Hours - Gas", "h", counter=True)),
    ("Operating Hours - Oil", param(BL, "Operating Hours - Oil", "h", counter=True)),
    ("Panel A/C Working Condition", param(BL, "Panel A/C Working Condition", None, sel="working")),
    ("Water Leakage", param(BL, "Water Leakage", None, sel="leak")),
    ("Steam Leakage", param(BL, "Steam Leakage", None, sel="leak")),
    ("Burner Flame Sight Glass", param(BL, "Burner Flame Sight Glass", None, sel="clear")),
    ("Blowdown Valve", param(BL, "Blowdown Valve", None, sel="working")),
])
section(r, "Gas", "shift", fields=[
    ("Gas Pressure (high) (bar)", param(BL, "Gas Pressure (high)", "bar")),
    ("Gas Pressure (low) (mbar)", param(BL, "Gas Pressure (low)", "mbar")),
    ("Gas Flowmeter Reading", param(BL, "Gas Flowmeter Reading", "m³", counter=True)),
])

# --- U1 WTP log (CHIENGUTRG06) ---------------------------------------------
r = register("u1-wtp", "U1", "CHIENGUTRG06", "Water Treatment Plant Log Report", "WTP", sort=30)
section(r, "Hourly WTP readings", "time", HOURLY_U1_WTP, [
    ("Raw Water Tank Level (%)", param(WT, "Raw Water Tank Level", "%", std="Raw Water Tank 1 Level", alt="> 90 % (tank block on the standard sheet)"), "TNK-UT"),
    ("Process Water Tank Level (%)", param(WT, "Process Water Tank Level", "%", mn=90, written="> 90%"), "TNK-UT"),
    ("Backwashing Water Tank Level (%)", param(WT, "Backwashing Water Tank Level", "%", mn=90, written="> 90%"), "TNK-UT"),
    ("Raw Water Pumps Pressure (bar)", param(WT, "Raw Water Pump Pressure", "bar", std="Raw Water Pump Pressure", alt="< 6 bar (tank block on the standard sheet)"), "PMP-RW"),
    ("Process Water Pumps Pressure (bar)", param(WT, "Process Water Pump Pressure", "bar", std="Treated Water Pump Pressure"), "PMP-TW"),
    ("Raw Water flow rate (m³/hr)", param(WT, "Raw Water Flow Rate", "m³/h"), "PMP-RW"),
    ("Process Water flow rate (m³/hr)", param(WT, "Process Water Flow Rate", "m³/h"), "PMP-TW"),
    ("Caustic Dosing Rate (l/hr)", param(WT, "Caustic Dosing Rate", "l/h"), "SYS-U1"),
    ("On-line Water pH", param(WT, "On-line Water pH", None, std="Water pH"), "SYS-U1"),
    ("Raw Water pH", param(WT, "Raw Water pH", None, mn=6.0, written="> 6.0"), "SYS-U1"),
    ("Process Water pH", param(WT, "Process Water pH", None, std="Water pH"), "SYS-U1"),
])

# --- U1 WTP equipment (CHIENGUTRG05) ---------------------------------------
r = register("u1-wtp-equipment", "U1", "CHIENGUTRG05", "Water Treatment Equipment Log Report", "WTP Equipment", sort=31)
pre_in = param(WT, "Pre-Filter Bag Unit Inlet Pressure", "bar", std="Pre-Filter Bag Unit Inlet Pressure")
pre_out = param(WT, "Pre-Filter Bag Unit Outlet Pressure", "bar", std="Pre-Filter Bag Unit Outlet Pressure")
pft_in = param(WT, "Pressure Filter Tank Inlet Pressure", "bar", std="Pressure Filter Tank Inlet Pressure")
pft_out = param(WT, "Pressure Filter Tank Outlet Pressure", "bar", std="Pressure Filter Tank Outlet Pressure")
post_in = param(WT, "Post-Filter Bag Unit Inlet Pressure", "bar", std="Post-Filter Bag Unit Inlet Pressure")
post_out = param(WT, "Post-Filter Bag Unit Outlet Pressure", "bar", std="Post-Filter Bag Unit Outlet Pressure")
f = []
for unit in ["1 & 2", "3", "4", "5", "6", "7"]:
    f += [(f"Pre-Filter Bag Unit {unit} IN (bar)", pre_in, "FLT-PRE"), (f"Pre-Filter Bag Unit {unit} OUT (bar)", pre_out, "FLT-PRE")]
for t in range(1, 8):
    f += [(f"Pressure Filter Tank {t} IN (bar)", pft_in, f"PFT-{t:02d}"), (f"Pressure Filter Tank {t} OUT (bar)", pft_out, f"PFT-{t:02d}")]
f += [("Post Filter Bag Unit IN (bar)", post_in, "FLT-POST"), ("Post Filter Bag Unit OUT (bar)", post_out, "FLT-POST")]
f += [(f"UV-{l} Intensity", param(WT, "UV Intensity", "W/cm²", std="UV Intensity",
                                  review="Unit printed as W/cm²; usually mW/cm² or %. Please confirm."), f"UV-{i:02d}")
      for i, l in enumerate("ABCD", start=1)]
f += [(f"Borehole {b} Pressure (bar)", param(WT, "Borehole Line Pressure", "bar"), f"BH-{b:02d}") for b in range(1, 8)]
f += [("Borehole 2&3 Tank Level (%)", param(WT, "Borehole 2&3 Tank Level", "%"), "TNK-UT"),
      ("PFT Inlet Valves Check", param(WT, "PFT Inlet Valves Check", None, sel="okay"), "SYS-U1"),
      ("PFT Outlet Actuator Valves Check", param(WT, "PFT Outlet Actuator Valves Check", None, sel="okay"), "SYS-U1"),
      ("Water Leakage Check", param(WT, "Water Leakage Check", None, sel="leak"), "SYS-U1")]
section(r, "Filters, UV & boreholes", "shift", fields=f)

# --- U1 Air compressors (CHIENGUTRG01) -------------------------------------
r = register("u1-compressor-oil", "U1", "CHIENGUTRG01", "Air Compressor Log Report (Oil)", "Air Compressors",
             assets=["CMP-02"], sort=40)
section(r, "Operating readings", "time", SIX_HOURLY, [
    ("Aftercooler Discharge Temp. (°C)", param(AIR_OIL, "Aftercooler Discharge Temp.", "°C")),
    ("Airend Discharge Temp. (°C)", param(AIR_OIL, "Airend Discharge Temp.", "°C")),
    ("Injected Coolant Temp. (°C)", param(AIR_OIL, "Injected Coolant Temp.", "°C")),
    ("Sump Pressure (bar)", param(AIR_OIL, "Sump Pressure", "bar")),
    ("Separator Pressure Drop (bar)", param(AIR_OIL, "Separator Pressure Drop", "bar")),
    ("Coolant Filter Pressure Drop (bar)", param(AIR_OIL, "Coolant Filter Pressure Drop", "bar", mx=0.9, written="< 0.9 bar")),
    ("Coolant Filter", param(AIR_OIL, "Coolant Filter", None, sel="okay")),
    ("Inlet Vacuum (bar)", param(AIR_OIL, "Inlet Vacuum", "bar")),
])
oil_checks = [
    ("Running Hours", param(AIR_OIL, "Running Hours", "h", counter=True)),
    ("Loaded Hours", param(AIR_OIL, "Loaded Hours", "h", counter=True)),
    ("Oil Level", param(AIR_OIL, "Oil Level", None, sel="oillevel")),
    ("Condensate Drain", param(AIR_OIL, "Condensate Drain", None, sel="functional")),
    ("Air Leakage", param(AIR_OIL, "Air Leakage", None, sel="leak")),
    ("Water Leakage", param(AIR_OIL, "Water Leakage", None, sel="leak")),
    ("Oil Leakage", param(AIR_OIL, "Oil Leakage", None, sel="leak")),
    ("Internal/ External Body Clean", param(AIR_OIL, "Internal/External Body Clean", None, sel="clean")),
]
section(r, "Hours & checks", "shift", fields=oil_checks)

r = register("u1-compressor-oilfree", "U1", "CHIENGUTRG01", "Air Compressor Log Report (Oil-free)", "Air Compressors",
             assets=[f"CMP-{n:02d}" for n in range(3, 10)], sort=41)
section(r, "Operating readings", "time", SIX_HOURLY, [
    ("Pkg Discharge Pressure (bar)", param(AIR_IR, "Package Discharge Pressure", "bar", std="Package Disch. Pressure")),
    ("Pkg Discharge Temp. (°C)", param(AIR_IR, "Package Discharge Temp.", "°C", std="Package Disch. Temp.")),
    ("Inlet Vacuum (bar)", param(AIR_IR, "Inlet Vacuum", "bar", std="Inlet Vacuum", review="Standard printed as '< 0.01 mmHg'; unit doesn't match the bar reading.")),
    ("1st Stage Inlet Temp. (°C)", param(AIR_IR, "1st Stage Inlet Temp.", "°C", std="1st Stage Inlet Temp.")),
    ("1st Stage Discharge Temp. (°C)", param(AIR_IR, "1st Stage Discharge Temp.", "°C", std="1st Stage Discharge Temp.")),
    ("2nd Stage Inlet Pressure (bar)", param(AIR_IR, "2nd Stage Inlet Pressure", "bar", std="2nd Stage Inlet Pressure")),
    ("2nd Stage Inlet Temp. (°C)", param(AIR_IR, "2nd Stage Inlet Temp.", "°C", std="2nd Stage Inlet Temp.")),
    ("2nd Stage Discharge Pressure (bar)", param(AIR_IR, "2nd Stage Discharge Pressure", "bar")),
    ("2nd Stage Discharge Temp. (°C)", param(AIR_IR, "2nd Stage Discharge Temp.", "°C")),
    ("Bearing Oil Temp. (°C)", param(AIR_IR, "Bearing Oil Temp.", "°C", std="Bearing Oil Temp.")),
    ("Bearing Oil Pressure (bar)", param(AIR_IR, "Bearing Oil Pressure", "bar", std="Bearing Oil Pressure")),
    ("Oil Filter Pressure Drop (bar)", param(AIR_IR, "Oil Filter Pressure Drop", "bar", std="Oil Filter Pressure Drop", alt="< 0.9 bar (Air Compressor 2 block)")),
    ("Package kW (kW)", param(AIR_IR, "Package kW", "kW")),
])
section(r, "Hours & checks", "shift", fields=[
    ("Running Hours", param(AIR_IR, "Running Hours", "h", counter=True)),
    ("Loaded Hours", param(AIR_IR, "Loaded Hours", "h", counter=True)),
    ("Oil Level", param(AIR_IR, "Oil Level", None, sel="oillevel", alt="> 70% (IR block on the standard sheet)")),
    ("Condensate Drain", param(AIR_IR, "Condensate Drain", None, sel="functional")),
    ("Air Leakage", param(AIR_IR, "Air Leakage", None, sel="leak")),
    ("Water Leakage", param(AIR_IR, "Water Leakage", None, sel="leak")),
    ("Oil Leakage", param(AIR_IR, "Oil Leakage", None, sel="leak")),
    ("Internal/ External Body Clean", param(AIR_IR, "Internal/External Body Clean", None, sel="clean")),
])

# --- U1 Air dryers (CHIENGUTRG02) ------------------------------------------
r = register("u1-dryer-ir", "U1", "CHIENGUTRG02", "Air Dryer (IR) Log Report", "Air Dryers",
             assets=["DRY-05", "DRY-06", "DRY-07", "DRY-08", "DRY-10", "DRY-11"], sort=50)
section(r, "Temperatures", "time", SIX_HOURLY, [
    ("Dew Point Pb1 (°C)", param(DRY_IR, "Dew Point", "°C", std="Dew Point")),
    ("Air Inlet Temperature Pb2 (°C)", param(DRY_IR, "Air Inlet Temperature", "°C", std="Air Inlet Temp.")),
    ("Ambient Temperature Pb3 (°C)", param(DRY_IR, "Ambient Temperature", "°C")),
    ("Suction Temperature Pb4 (°C)", param(DRY_IR, "Suction Temperature", "°C")),
])
section(r, "Hours & checks", "shift", fields=[
    ("Running Hours", param(DRY_IR, "Running Hours", "h", counter=True)),
    ("Glycol Level (%)", param(DRY_IR, "Glycol Level", "%", mn=70, written="> 70%")),
    ("Condensate Drain", param(DRY_IR, "Condensate Drain", None, sel="functional")),
    ("Air Leakage", param(DRY_IR, "Air Leakage", None, sel="leak")),
    ("Water Leakage", param(DRY_IR, "Water Leakage", None, sel="leak")),
    ("Internal/ External Body Clean", param(DRY_IR, "Internal/External Body Clean", None, sel="clean")),
])
r = register("u1-dryer-ac", "U1", "CHIENGUTRG02", "Air Dryer (Atlas Copco) Log Report", "Air Dryers", assets=["DRY-09"], sort=51)
section(r, "Readings", "time", SIX_HOURLY, [
    ("Condensing Pressure (bar)", param(DRY_AC, "Condensing Pressure", "bar", std="Condensing Pressure", review="Standard is a single value (25.5 bar). What tolerance?")),
    ("Dryer LAT (°C)", param(DRY_AC, "Dryer LAT", "°C", std="Dryer LAT")),
    ("Refrigerant Temperature (°C)", param(DRY_AC, "Refrigerant Temperature", "°C", std="Refrigerant Temperature")),
    ("Dryer Ambient Temperature (°C)", param(DRY_AC, "Dryer Ambient Temperature", "°C", std="Dryer Ambient Temperature")),
    ("Refrigerant Compressor Outlet (°C)", param(DRY_AC, "Refrigerant Compressor Outlet", "°C", std="Refrigerant Compressor Outlet")),
])
section(r, "Hours & checks", "shift", fields=[
    ("Running Hours", param(DRY_AC, "Running Hours", "h", counter=True)),
    ("Condensate Drain", param(DRY_AC, "Condensate Drain", None, sel="functional")),
    ("Air Leakage", param(DRY_AC, "Air Leakage", None, sel="leak")),
    ("Water Leakage", param(DRY_AC, "Water Leakage", None, sel="leak")),
    ("Internal/ External Body Clean", param(DRY_AC, "Internal/External Body Clean", None, sel="clean")),
])

# --- U1 Chillers (CHIENGUTRG07) --------------------------------------------
r = register("u1-trane", "U1", "CHIENGUTRG07", "Trane Chiller Log Report", "Chillers",
             assets=["CHT-01", "CHT-02", "CHT-04", "CHT-05"], sort=60)
section(r, "Compressor & evaporator", "time", SIX_HOURLY, [
    ("Oil Pressure (kPa)", param(TR, "Oil Pressure", "kPa", std="Oil Pressure (kPa)")),
    ("System Refrigerant Diff. Pressure (kPa)", param(TR, "System Refrigerant Diff. Pressure", "kPa", std="System Refrigerant Diff. Pressure (kPa)")),
    ("Comp Rfgt Discharge Temp (°C)", param(TR, "Comp Rfgt Discharge Temp", "°C", std="Comp Rfgt Discharge Temp (°C)", alt="60 - 70 (columns M-N on the standard sheet)")),
    ("% RLA", param(TR, "% RLA", "%", std="% RLA")),
    ("Evap Entering Water Temp. (°C)", param(TR, "Evap Entering Water Temp.", "°C")),
    ("Evap Leaving Water Temp. (°C)", param(TR, "Evap Leaving Water Temp.", "°C")),
    ("Evap Sat Rfgt Temp. (°C)", param(TR, "Evap Sat Rfgt Temp.", "°C", std="Evap Rfgt Sat. Temp. (°C)")),
    ("Evap Rfgt Pressure (kPa)", param(TR, "Evap Rfgt Pressure", "kPa", std="Evap Rfgt Pressure (kPa)")),
])
section(r, "Condenser", "time", SIX_HOURLY, [
    ("Evap Approach Temp (°C)", param(TR, "Evap Approach Temp", "°C", std="Evap Approach Temp (°C)")),
    ("Expansion Valve Position (%)", param(TR, "Expansion Valve Position", "%")),
    ("Evap Rfgt Liquid Level (mm)", param(TR, "Evap Rfgt Liquid Level", "mm", std="Evap Rfgt Liquid Level (mm)")),
    ("Cond Rfgt Pressure (kPa)", param(TR, "Cond Rfgt Pressure", "kPa", std="Cond Rfgt Pressure (kPa)")),
    ("Cond Entering Water Temp. (°C)", param(TR, "Cond Entering Water Temp.", "°C", std="Cond Inlet Temp. (°C)")),
    ("Cond Leaving Water Temp. (°C)", param(TR, "Cond Leaving Water Temp.", "°C", std="Cond Outlet Temp. (°C)")),
    ("Cond Sat Rfgt Temp (°C)", param(TR, "Cond Sat Rfgt Temp", "°C", std="Cond Sat Rfgt Temp (°C)")),
    ("Condenser Approach Temp (°C)", param(TR, "Condenser Approach Temp", "°C", std="Condenser Approach Temp (°C)")),
])
section(r, "Shift checks", "shift", fields=[
    ("Compressor Running Time (h)", param(TR, "Compressor Running Time", "h", counter=True)),
    ("Oil Leakage", param(TR, "Oil Leakage", None, sel="leak")),
    ("Cooling Water Inlet Pressure (bar)", param(TR, "Cooling Water Inlet Pressure", "bar")),
    ("Chilled Water Inlet Pressure (bar)", param(TR, "Chilled Water Inlet Pressure", "bar")),
])

r = register("u1-vam", "U1", "CHIENGUTRG07", "VAM Chiller Log Report", "Chillers", assets=["CHV-01", "CHV-02", "CHV-03"], sort=61)
section(r, "Burner & chilled water", "time", SIX_HOURLY, [
    ("Burner/Steam Selection", param(VM, "Burner/Steam Selection", None, sel="burner")),
    ("Burner (%)", param(VM, "Burner", "%")),
    ("Steam (%)", param(VM, "Steam", "%")),
    ("Exhaust Stack Temperature (°C)", param(VM, "Exhaust Stack Temperature", "°C")),
    ("Chilled Water Inlet Temperature (°C)", param(VM, "Chilled Water Inlet Temperature", "°C")),
    ("Chilled Water Outlet Temperature (°C)", param(VM, "Chilled Water Outlet Temperature", "°C")),
    ("Chilled Water Differential Pressure (mmWC)", param(VM, "Chilled Water Differential Pressure", "mmWC")),
    ("Chilled Water Flow (m³/hr)", param(VM, "Chilled Water Flow", "m³/h")),
])
section(r, "Generator & solution", "time", SIX_HOURLY, [
    ("Cooling Water Inlet Temperature (°C)", param(VM, "Cooling Water Inlet Temperature", "°C", std="Hot/Cooling Water Inlet Temp.")),
    ("Cooling Water Outlet Temperature (°C)", param(VM, "Cooling Water Outlet Temperature", "°C", std="Hot/Cooling Water Outlet Temp.")),
    ("High Temperature Generator (°C)", param(VM, "High Temperature Generator", "°C")),
    ("Low Temperature Generator (°C)", param(VM, "Low Temperature Generator", "°C", std="Low Temp. Generator")),
    ("Spray Solution Concentration (%)", param(VM, "Spray Solution Concentration", "%", std="Concentration")),
    ("Intermediate Concentration (%)", param(VM, "Intermediate Concentration", "%")),
    ("Spray Solution Temperature (°C)", param(VM, "Spray Solution Temperature", "°C", std="Spray Solution Temp.")),
])
section(r, "Shift checks", "shift", fields=[
    ("Running Hours", param(VM, "Running Hours", "h", counter=True)),
    ("Vacuum Pump Oil Level (%)", param(VM, "Vacuum Pump Oil Level", "%", mn=50, written="> 50%")),
    ("Vacuum (mmHg)", param(VM, "Vacuum", "mmHg", std="Vacuum Pressure mmHg")),
    ("Chilled Water Inlet Pressure (bar)", param(VM, "Chilled Water Inlet Pressure", "bar", std="Chilled Water Inlet Pressure (bar)")),
    ("Chilled Water Outlet Pressure (bar)", param(VM, "Chilled Water Outlet Pressure", "bar", std="Chilled Water Outlet Pressure (bar)")),
    ("Cooling Water Inlet Pressure (bar)", param(VM, "Cooling Water Inlet Pressure", "bar", std="Hot/Cooling Water Inlet Pressure")),
    ("Cooling Water Outlet Pressure (bar)", param(VM, "Cooling Water Outlet Pressure", "bar", std="Hot/Cooling Water Outlet Pressure")),
    ("HTG Vapour Temperature (°C)", param(VM, "HTG Vapour Temperature", "°C", std="High Temp. Generator Vapour Temp.")),
    ("Gas Flowmeter Reading", param(VM, "Gas Flowmeter Reading", "m³", counter=True)),
    ("U-tube Temperature (°C)", param(VM, "U-tube Temperature", "°C", std="U-tube Temp.")),
    ("Dilute Temperature (°C)", param(VM, "Dilute Temperature", "°C")),
    ("HTHE Out Temperature Generator (°C)", param(VM, "HTHE Out Temperature", "°C")),
    ("Refrigerant Outlet Temperature (°C)", param(VM, "Refrigerant Outlet Temperature", "°C")),
    ("Overflow Temperature (°C)", param(VM, "Overflow Temperature", "°C")),
    ("Condensate Outlet Temperature (°C)", param(VM, "Condensate Outlet Temperature", "°C")),
    ("Gas Pressure (high) (bar)", param(VM, "Gas Pressure (high)", "bar")),
    ("Gas Pressure (low) (mbar)", param(VM, "Gas Pressure (low)", "mbar")),
])

# --- Nitrogen (CHIENGUTRG09 / CHIENGUTLOGNG01) -----------------------------
for area, doc, codes in [("U1", "CHIENGUTRG09", [f"N2G-{n:02d}" for n in range(1, 5)]),
                         ("U2", "CHIENGUTLOGNG01", ["N2G-U2-01", "N2G-U2-02"])]:
    r = register(f"{area.lower()}-nitrogen", area, doc, "Nitrogen Generator Log Report", "Nitrogen", assets=codes, sort=70)
    section(r, "Daily readings", "daily", fields=[
        ("N2 Purity (%)", param(N2, "N2 Purity", "%")),
        ("Air Inlet Pressure (bar)", param(N2, "Air Inlet Pressure", "bar")),
        ("Nitrogen Outlet Pressure (bar)", param(N2, "Nitrogen Outlet Pressure", "bar")),
        ("Operating Hours", param(N2, "Operating Hours", "h", counter=True)),
        ("Flow rate (m³/hr)", param(N2, "Flow Rate", "m³/h")),
        ("Total flow (m³)", param(N2, "Total Flow", "m³", counter=True)),
    ])

# --- Thermax THDC2 logbook (CHIENGUT07) & IR dryer logbook (CHIENGRGUT02) --
for area, vam_asset, dryer_assets in [("U1", ["CHV-04"], ["DRY-01", "DRY-02", "DRY-03", "DRY-04"]),
                                      ("U2", ["CHV-U2"], ["DRY-12"])]:
    r = register(f"{area.lower()}-thermax-logbook", area, "CHIENGUT07", "Chiller Logbook THERMAX (THDC2)",
                 "VAM Chiller" if area == "U1" else "VAM Chiller_", assets=vam_asset, sort=62,
                 description="Asset assignment is a guess: please confirm which VAM chiller this logbook covers.")
    section(r, "Hourly logbook", "time", HOURLY_24_FROM8, [
        ("Chilled Water Flow rate", param(VM, "Chilled Water Flow", "m³/h")),
        ("Chilled Water Inlet Temp. (°C)", param(VM, "Chilled Water Inlet Temperature", "°C")),
        ("Chilled Water Outlet Temp. (°C)", param(VM, "Chilled Water Outlet Temperature", "°C")),
        ("Chilled Water Inlet Pressure (bar)", param(VM, "Chilled Water Inlet Pressure", "bar")),
        ("Chilled Water Outlet Pressure (bar)", param(VM, "Chilled Water Outlet Pressure", "bar")),
        ("Hot/Cooling Water Flow rate", param(VM, "Hot/Cooling Water Flow Rate", "m³/h", std="Hot/Cooling Water Flow rate")),
        ("Hot/Cooling Water Inlet Temp. (°C)", param(VM, "Cooling Water Inlet Temperature", "°C")),
        ("Hot/Cooling Water Outlet Temp. (°C)", param(VM, "Cooling Water Outlet Temperature", "°C")),
        ("Hot/Cooling Water Inlet Pressure (bar)", param(VM, "Cooling Water Inlet Pressure", "bar")),
        ("Hot/Cooling Water Outlet Pressure (bar)", param(VM, "Cooling Water Outlet Pressure", "bar")),
        ("High Temp. Generator Vapour Temp. (°C)", param(VM, "HTG Vapour Temperature", "°C")),
        ("U-tube Temp. (°C)", param(VM, "U-tube Temperature", "°C")),
        ("Low Temp. Generator (°C)", param(VM, "Low Temperature Generator", "°C")),
        ("Spray Solution Temp. (°C)", param(VM, "Spray Solution Temperature", "°C")),
        ("High Temp. Generator Top Temp. (°C)", param(VM, "HTG Top Temperature", "°C", std="High Temp. Generator Top Temp.")),
        ("High Temp. Generator Bottom Temp. (°C)", param(VM, "HTG Bottom Temperature", "°C", std="High Temp. Generator Bottom Temp.")),
        ("Absolute Difference", param(VM, "Absolute Difference", None)),
        ("% Steam Control Valve Opening", param(VM, "Steam Control Valve Opening", "%")),
        ("Concentration (%)", param(VM, "Spray Solution Concentration", "%")),
        ("Vacuum Pressure (mmHg)", param(VM, "Vacuum", "mmHg")),
        ("Generator Fluid Level (%)", param(VM, "Generator Fluid Level", "%", std="Generator Fluid Level")),
        ("Absorber Fluid Level (%)", param(VM, "Absorber Fluid Level", "%", std="Absorber Fluid Level")),
        ("Evaporator Fluid Level (%)", param(VM, "Evaporator Fluid Level", "%", std="Evaporator Fluid Level")),
        ("Steam Pressure before SCV (bar)", param(VM, "Steam Pressure before SCV", "bar", std="Steam Pressure before SCV")),
    ])
    r = register(f"{area.lower()}-dryer-logbook", area, "CHIENGRGUT02", "Air Dryer Logbook", "Air Dryer IR",
                 assets=dryer_assets, sort=52,
                 description="Asset assignment is a guess: please confirm which dryers use this logbook.")
    section(r, "Hourly logbook", "time", HOURLY_24_FROM8, [
        ("Condensate Drain", param(DRY_IR, "Condensate Drain", None, sel="functional")),
        ("Air Leakage", param(DRY_IR, "Air Leakage", None, sel="leak")),
        ("Water Leakage", param(DRY_IR, "Water Leakage", None, sel="leak")),
        ("Noise Level", param(DRY_IR, "Noise Level", None, sel="noise")),
        ("Air Inlet Temp. (°C)", param(DRY_IR, "Air Inlet Temperature", "°C")),
        ("Air Outlet Temp. (°C)", param(DRY_IR, "Air Outlet Temperature", "°C")),
        ("Dew Point (°C)", param(DRY_IR, "Dew Point", "°C")),
    ])

# --- U2 general log (CHIENGUTRG11) ------------------------------------------
r = register("u2-general", "U2", "CHIENGUTRG11", "Utility General Log Report", "General", sort=12)
section(r, "3-hourly readings", "time", THREE_HOURLY_U2, [
    ("Feed Water Tank Level (%)", param(BL, "Feed Water Tank Level", "%"), "SYS-U2"),
    ("Feed Water Tank Temp. (°C)", param(BL, "Feed Water Tank Temperature", "°C"), "SYS-U2"),
    ("Chilled Water Tank Level (%)", param(GU, "Chilled Water Tank Level %", "%"), "SYS-U2"),
    ("CHI Snacks-1 Chilled Water Pump Pressure (bar)", param(GU, "Chilled Water Pump Pressure", "bar"), "SYS-U2"),
    ("CHI Snacks-2 Chilled Water Pump Pressure (bar)", param(GU, "Chilled Water Pump Pressure", "bar"), "SYS-U2"),
    ("Pharma Chilled Water Pump Pressure (bar)", param(GU, "Chilled Water Pump Pressure", "bar"), "SYS-U2"),
    ("Compressed Air Line Pressure (bar)", param(GU, "Air Line Pressure", "bar"), "SYS-U2"),
])
section(r, "Water analysis", "shift", fields=[
    ("Cooling Tower Feedwater pH", param(GU, "Cooling Tower Feedwater pH", None), "SYS-U2"),
    ("Cooling Tower Feedwater Conductivity (µS/cm)", param(GU, "Cooling Tower Feedwater Conductivity", "µS/cm"), "SYS-U2"),
    ("Cooling Tower Water Total Hardness (ppm)", param(GU, "Cooling Tower Water Total Hardness", "ppm"), "SYS-U2"),
    ("Boiler Feedwater pH", param(BW, "Feed Water pH", None), "SYS-U2"),
    ("Boiler Feedwater Conductivity (µS/cm)", param(BW, "Feed Water Conductivity", "µS/cm"), "SYS-U2"),
    ("Boiler Feedwater Total Hardness (ppm)", param(BW, "Feed Water Total Hardness", "ppm"), "SYS-U2"),
])
section(r, "Chemical & tank levels", "shift", fields=[
    ("Oxygen Scavenger Tank Level", param(BL, "Oxygen Scavenger Tank Level (band)", None, sel="level3"), "SYS-U2"),
    ("Sludge Dispersant Tank Level", param(BL, "Sludge Dispersant Tank Level (band)", None, sel="level3"), "SYS-U2"),
    ("Sludge & Corrosion Inhibitor Tank Level", param(GU, "Sludge & Corrosion Inhibitor Tank Level", None, sel="level3"), "SYS-U2"),
    ("Oxidizing Biocide Tank Level", param(GU, "Oxidizing Biocide Tank Level", None, sel="level3"), "SYS-U2"),
    ("Non-Oxidizing Biocide Tank Level", param(GU, "Non-Oxidizing Biocide Tank Level", None, sel="level3"), "SYS-U2"),
    ("VAM Cooling Tower Basin Level", param(GU, "VAM Cooling Tower Basin Level", None, sel="level3"), "SYS-U2"),
    ("Softener Plant Tank", param(WT, "Softener Plant Salt Level", None, sel="salt"), "SYS-U2"),
])

# --- U2 hourly equipment logs -----------------------------------------------
r = register("u2-boiler-2t", "U2", "CHIENGUTRG03", "2 Tons/hr Boiler Log Report", "2Tons Boiler", assets=["BLR-06"], sort=20)
section(r, "Hourly readings", "time", HOURLY_U2, [
    ("Steam Pressure (bar)", param(BL, "Steam Pressure", "bar")),
    ("Boiler Water Level (%)", param(BL, "Water Level", "%")),
    ("Flue Gas Temperature (°C)", param(BL, "Flue Gas Temperature", "°C")),
    ("Feedwater Pump Pressure (bar)", param(BL, "Feedwater Pump Pressure", "bar")),
    ("Oil Pump Working No 1/2", param(BL, "Oil Pump Working", None)),
    ("Feedwater Pump Working No 1/2", param(BL, "Feedwater Pump Working", None)),
])
r = register("u2-boiler-wh", "U2", "CHIENGUTRG03", "3.5 Tons/hr Waste Heat Boiler Log Report", "WH Boiler", assets=["BLR-07"], sort=21)
section(r, "Hourly readings", "time", HOURLY_U2,
        [(f"From Engine-{i} Temperature (°C)", param("Waste Heat Boiler", f"From Engine-{i} Temperature", "°C")) for i in (1, 2, 3)]
        + [(f"To Chimney-{i} Temperature (°C)", param("Waste Heat Boiler", f"To Chimney-{i} Temperature", "°C")) for i in (1, 2, 3)]
        + [("Boiler Steam Pressure (bar)", param(BL, "Steam Pressure", "bar")),
           ("Boiler Water Level (%)", param(BL, "Water Level", "%")),
           ("Level Control Valve Opening (%)", param("Waste Heat Boiler", "Level Control Valve Opening", "%")),
           ("Feedwater Pump Working No 1/2", param(BL, "Feedwater Pump Working", None))])
r = register("u2-wtp", "U2", "CHIENGUTRG06", "Water Treatment Plant Log Report", "WTP", sort=30)
section(r, "Hourly readings", "time", HOURLY_U2, [
    ("Process Water Tank Level (%)", param(WT, "Process Water Tank Level", "%"), "SYS-U2"),
    ("Process Water Pressure (bar)", param(WT, "Process Water Pump Pressure", "bar"), "SYS-U2"),
    ("Process Water Flow Rate (m³/hr)", param(WT, "Process Water Flow Rate", "m³/h"), "SYS-U2"),
    ("Water Pump Frequency (Hz)", param(WT, "Water Pump Frequency", "Hz"), "SYS-U2"),
    ("Water Leakage Check", param(WT, "Water Leakage Check", None), "SYS-U2"),
])
r = register("u2-compressor", "U2", "CHIENGUTRG01", "IR MH75 Air Compressor Log Report", "Air Compressor", assets=["CMP-13"], sort=40)
section(r, "Hourly readings", "time", HOURLY_U2, [
    ("Discharge Pressure (bar)", param(AIR_OIL, "Discharge Pressure", "bar")),
    ("Airend Oil Temp. (°C)", param(AIR_OIL, "Airend Oil Temp.", "°C")),
    ("Oil Sump Pressure (bar)", param(AIR_OIL, "Sump Pressure", "bar")),
    ("Running Hours", param(AIR_OIL, "Running Hours", "h")),
    ("Loaded Hours", param(AIR_OIL, "Loaded Hours", "h")),
])
r = register("u2-dryer", "U2", "CHIENGUTRG02", "IR TMS Air Dryer Log Report", "Air Dryer", assets=["DRY-12"], sort=50)
section(r, "Hourly readings", "time", HOURLY_U2, [
    ("Dew Point (°C)", param(DRY_IR, "Dew Point", "°C")),
    ("Air Outlet Pressure (bar)", param(DRY_IR, "Air Outlet Pressure", "bar")),
    ("Condenser Pressure HP (bar)", param(DRY_IR, "Condenser Pressure HP", "bar")),
    ("Evaporator Pressure LP (bar)", param(DRY_IR, "Evaporator Pressure LP", "bar")),
])
CLV = "Clivet Chiller"
r = register("u2-clivet", "U2", "CHIENGUTRG07", "Clivet Chiller Log Report", "Clivet Chiller", assets=["CHC-01"], sort=60)
section(r, "2-hourly readings", "time", TWO_HOURLY_U2, [
    ("Chilled Water Inlet Temperature (°C)", param(CLV, "Chilled Water Inlet Temperature", "°C")),
    ("Chilled Water Outlet Temperature (°C)", param(CLV, "Chilled Water Outlet Temperature", "°C")),
    ("Chilled Water Inlet Pressure (bar)", param(CLV, "Chilled Water Inlet Pressure", "bar")),
    ("Chilled Water Outlet Pressure (bar)", param(CLV, "Chilled Water Outlet Pressure", "bar")),
    ("Compressor 1 Condenser Pressure HP (bar)", param(CLV, "Compressor 1 Condenser Pressure HP", "bar")),
    ("Compressor 1 Evaporator Pressure LP (bar)", param(CLV, "Compressor 1 Evaporator Pressure LP", "bar")),
    ("Compressor 2 Condenser Pressure HP (bar)", param(CLV, "Compressor 2 Condenser Pressure HP", "bar")),
    ("Compressor 2 Evaporator Pressure LP (bar)", param(CLV, "Compressor 2 Evaporator Pressure LP", "bar")),
])
section(r, "Shift checks", "shift", fields=[
    ("Compressor 1 Oil Level", param(CLV, "Compressor 1 Oil Level", None, sel="lnh")),
    ("Compressor 2 Oil Level", param(CLV, "Compressor 2 Oil Level", None, sel="lnh")),
    ("Chilled Water Outlet Pressure (bar)", param(CLV, "Chilled Water Outlet Pressure", "bar")),
    ("Cooling Water Inlet Pressure (bar)", param(CLV, "Cooling Water Inlet Pressure", "bar")),
    ("Refrigerant Leakage", param(CLV, "Refrigerant Leakage", None, sel="leak")),
    ("Water Leakage", param(CLV, "Water Leakage", None, sel="leak")),
    ("Components Physical Damage", param(CLV, "Components Physical Damage", None, sel="damage")),
    ("Chilled Water Pump Working No 1/2", param(CLV, "Chilled Water Pump Working", None, sel="pump12")),
])
r = register("u2-vam", "U2", "CHIENGUTRG07", "VAM Chiller Log Report", "VAM Chiller", assets=["CHV-U2"], sort=61)
section(r, "2-hourly readings", "time", TWO_HOURLY_U2, [
    ("Steam Control Valve Opening (%)", param(VM, "Steam Control Valve Opening", "%")),
    ("Chilled Water Inlet Temperature (°C)", param(VM, "Chilled Water Inlet Temperature", "°C")),
    ("Chilled Water Outlet Temperature (°C)", param(VM, "Chilled Water Outlet Temperature", "°C")),
    ("Cooling Water Inlet Temperature (°C)", param(VM, "Cooling Water Inlet Temperature", "°C")),
    ("Cooling Water Outlet Temperature (°C)", param(VM, "Cooling Water Outlet Temperature", "°C")),
    ("High Temperature Generator (°C)", param(VM, "High Temperature Generator", "°C")),
    ("High Temp. Generator Vapour (°C)", param(VM, "HTG Vapour Temperature", "°C")),
    ("U-Tube Temperature (°C)", param(VM, "U-tube Temperature", "°C")),
    ("Low Temperature Generator (°C)", param(VM, "Low Temperature Generator", "°C")),
    ("Spray Solution Temperature (°C)", param(VM, "Spray Solution Temperature", "°C")),
    ("High Temp. Generator Top (°C)", param(VM, "HTG Top Temperature", "°C")),
    ("High Temp. Generator Bottom (°C)", param(VM, "HTG Bottom Temperature", "°C")),
    ("Spray Solution Concentration (%)", param(VM, "Spray Solution Concentration", "%")),
    ("Vacuum (mmHg)", param(VM, "Vacuum", "mmHg")),
    ("Instant TR Generated", param(VM, "Instant TR Generated", "TR")),
])
section(r, "Shift checks", "shift", fields=[
    ("Running Hours", param(VM, "Running Hours", "h")),
    ("Vacuum Pump Oil Level", param(VM, "Vacuum Pump Oil Level (sight glass)", None, sel="boa")),
    ("Chilled Water Inlet Pressure (bar)", param(VM, "Chilled Water Inlet Pressure", "bar")),
    ("Chilled Water Outlet Pressure (bar)", param(VM, "Chilled Water Outlet Pressure", "bar")),
    ("Cooling Water Inlet Pressure (bar)", param(VM, "Cooling Water Inlet Pressure", "bar")),
    ("Cooling Water Outlet Pressure (bar)", param(VM, "Cooling Water Outlet Pressure", "bar")),
    ("High Temperature Generator Level", param(VM, "High Temperature Generator Level", None, sel="lnh")),
    ("Absorber Level", param(VM, "Absorber Level", None, sel="lnh")),
    ("Refrigerant Level", param(VM, "Refrigerant Level", None, sel="lnh")),
    ("Chilled Water Pump Working No 1/2", param(VM, "Chilled Water Pump Working", None, sel="pump12")),
    ("Cooling Water Pump Working No 1/2", param(VM, "Cooling Water Pump Working", None, sel="pump12")),
    ("Cooling Tower Fan Working", param(VM, "Cooling Tower Fan Working", None, sel="oneboth")),
])

# Remaining standard-sheet rows not used on any form (kept so limits are in one place)
for (g, n), row in STD.items():
    if g == "Boiler Water":
        param(BW, f"Boiler Water {n}", None, std=f"{g}|{n}",
              review="Unit printed as ppm; conductivity is normally µS/cm." if "Conductivity" in n else None)

# ---------------------------------------------------------------------------
# Emit SQL
# ---------------------------------------------------------------------------

def build() -> dict:
    """Compact, key-based master data (no generated IDs) for public.load_master_data()."""
    def clean(d):
        # keep numeric zeros (0 == False in Python, so test types explicitly)
        return {k: v for k, v in d.items() if not (v is None or v is False or v == [] or v == "")}

    return {
        "categories": CATEGORIES,
        "assets": [clean({"code": code, "name": name, "category": cat, "area": area, "make": make,
                          "confirmed": confirmed, "notes": notes,
                          "aliases": [[src, al] for src, al in aliases]})
                   for code, name, cat, area, make, confirmed, notes, aliases in ASSETS],
        "parameters": [clean({"group": g, "name": n, "unit": p["unit"],
                              "type": None if p["data_type"] == "number" else p["data_type"],
                              "options": p["options"], "ok": p["ok"], "min": p["std_min"], "max": p["std_max"],
                              "written": p["written"], "source": p["source"], "alt": p["alt"],
                              "review": p["needs_review"], "note": p["review"], "counter": p["counter"]})
                       for (g, n), p in PARAMS.items()],
        "registers": [clean({"key": r["key"], "area": r["area"], "doc": r["doc"], "title": r["title"],
                             "sheet": r["sheet"], "description": r["description"], "sort": r["sort"],
                             "assets": r["assets"],
                             "sections": [clean({"title": s["title"], "kind": s["kind"], "times": s["times"],
                                                 "fields": [[f[0], f[1][0], f[1][1], f[2] if len(f) > 2 else None]
                                                            for f in s["fields"]]})
                                          for s in r["sections"]]})
                      for r in REGISTERS],
    }


def main() -> None:
    for r in REGISTERS:
        for s in r["sections"]:
            for f in s["fields"]:
                if f[1] not in PARAMS:
                    raise SystemExit(f"Unknown parameter {f[1]} on {r['key']}")
    data = build()
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "seed_data/master_data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    dest = ROOT / "supabase/seed/10_master_data.sql"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("-- GENERATED by scripts/build_seed.py from seed_data/master_data.json. Do not edit by hand.\n"
                    "select public.load_master_data($json$" + blob + "$json$::jsonb);\n", encoding="utf-8")

    review = {
        "unmapped_pm_names": UNMAPPED_PM,
        "assets_to_confirm": [a[0] + " " + a[1] for a in ASSETS if not a[5]],
        "parameters_to_review": [f"{g}: {n}: {p['review']}" for (g, n), p in PARAMS.items() if p["needs_review"]],
    }
    (ROOT / "docs/owner_review.json").write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"assets={len(ASSETS)} parameters={len(PARAMS)} registers={len(REGISTERS)} "
          f"fields={sum(len(s['fields']) for r in REGISTERS for s in r['sections'])} json_bytes={len(blob)}")


if __name__ == "__main__":
    main()
