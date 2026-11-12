"""Downtime cause tree: downtime type -> failure category -> failure mode -> suggested issue descriptions,
with machine-specific modes per equipment category (owner request, 2026-11-12).

Writes seed_data/downtime_causes.json. Rows with "equip": null apply to every machine; others only to that equipment
category. The section manager can edit the tree in Admin -> Downtime causes after loading.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rows = []

UNPLANNED = "Unplanned Breakdown"
CBM = "Condition-Based Maintenance (CBM)"
PLANNED = "Planned Maintenance"
EXTERNAL = "External Supply Failure"


def add(dtype, equip, cat, modes):
    """modes: list of "mode" or ("mode", [issue descriptions])."""
    for m in modes:
        mode, issues = (m, []) if isinstance(m, str) else m
        rows.append({"type": dtype, "equip": equip, "category": cat, "mode": mode, "issues": issues, "sort": len(rows) + 1})


# ---------------------------------------------------------------- symptoms used as issue descriptions
TRIP = ["Equipment tripped during operation", "Equipment shut down on alarm", "Fault code displayed on HMI / panel"]
NOSTART = ["Equipment failed to start", "Loss of power to equipment"]
NOISE = ["Abnormal noise observed", "Excessive vibration observed", "Overheating observed"]
LEAK = ["Leakage observed"]

# ---------------------------------------------------------------- unplanned breakdown: every machine
add(UNPLANNED, None, "Mechanical", [
    ("Bearing failure", NOISE), ("Mechanical seal / gasket leakage", LEAK), ("Coupling failure", NOISE),
    ("Impeller / rotor damage", NOISE + ["Low output flow"]), ("Belt failure or slippage", NOISE),
    ("Valve failure (passing / stuck)", LEAK + ["Pressure fluctuation"]), ("Pipe or line leakage", LEAK),
    ("Excessive vibration / misalignment", NOISE), ("Fan / blower fault", NOISE), ("Gearbox fault", NOISE),
    ("Lubrication failure", NOISE), ("General mechanical wear", NOISE)])
add(UNPLANNED, None, "Electrical", [
    ("Motor failure / burnt winding", NOSTART + ["Motor overload trip"]), ("Overload trip", ["Motor overload trip"] + TRIP),
    ("Contactor / relay fault", NOSTART), ("Cable or wiring fault", NOSTART), ("VFD / soft starter fault", TRIP + NOSTART),
    ("Panel / circuit breaker fault", NOSTART), ("Earth fault", TRIP), ("Capacitor / power factor fault", TRIP),
    ("Generator changeover failure (plant generator)", ["Loss of power to equipment"])])
add(UNPLANNED, None, "Instrumentation and Control", [
    ("Sensor / transmitter fault", TRIP), ("PLC or controller fault", TRIP + NOSTART), ("HMI / display fault", ["Fault code displayed on HMI / panel"]),
    ("Pressure switch fault", TRIP), ("Level control fault", ["Low water level alarm", "High water level alarm", "Tank overflow"]),
    ("Temperature control fault", ["Overheating observed"]), ("Solenoid valve fault", NOSTART), ("Calibration drift", ["Pressure fluctuation"]),
    ("Communication / signal loss", ["Fault code displayed on HMI / panel"]), ("Flow meter fault", ["Flow fluctuation"]),
    ("Safety interlock trip", TRIP), ("Emergency stop activated", ["Emergency stop activated"])])
add(UNPLANNED, None, "Process and Utility", [
    ("Fouling / scaling", ["Low output flow", "Overheating observed"]), ("Output below demand (capacity)", ["Low output pressure", "Low output flow"])])
for equip in ("Boilers", "Water Treatment", "Degassers"):
    add(UNPLANNED, equip, "Process and Utility", [("Chemical dosing failure", ["Poor water quality at outlet"])])
add(UNPLANNED, "Boilers", "Process and Utility", [("Low feed water supply", ["Tank level low", "Low water level alarm"])])
for equip in ("Pumps", "Jet Pumps", "Boreholes"):
    add(UNPLANNED, equip, "Process and Utility", [("Air / gas locking", ["Pump not priming / loss of suction"])])
add(UNPLANNED, None, "Operational", [
    ("Operator error", TRIP), ("Delayed start-up / shutdown", []), ("Improper changeover", TRIP), ("Delayed response to alarm", TRIP),
    ("Manpower shortage", []), ("Wrong parameter setting", TRIP)])
add(UNPLANNED, None, "Maintenance and Spares", [
    ("Spare parts unavailable", ["Equipment awaiting spare parts"]), ("Awaiting vendor / OEM support", ["Equipment awaiting vendor attention"]),
    ("Awaiting CAPEX approval", ["Equipment isolated for repairs"]), ("Extended repair duration", ["Equipment isolated for repairs"]),
    ("Repeat failure / poor previous repair", TRIP), ("Tooling unavailable", ["Equipment isolated for repairs"])])

# ---------------------------------------------------------------- unplanned breakdown: machine-specific
add(UNPLANNED, "Boilers", "Mechanical", [
    ("Boiler tube leak / tube failure", ["Steam leakage observed", "Water carryover observed", "Low steam pressure"]),
    ("Feed water pump failure", ["Low water level alarm", "Pump not priming / loss of suction"]),
    ("Burner fan / combustion air blower failure", TRIP + NOISE), ("Safety valve passing / lifting", ["Steam leakage observed"]),
    ("Blowdown valve stuck / passing", LEAK), ("Refractory damage", ["Overheating observed"]), ("Economiser leak", LEAK),
    ("Furnace / smoke tube fouling (soot)", ["High flue gas temperature", "Low steam pressure"])])
add(UNPLANNED, "Boilers", "Instrumentation and Control", [
    ("Flame failure / flame sensor (scanner) fault", ["Flame failure alarm", "Equipment failed to start"] + TRIP),
    ("Low water level trip", ["Low water level alarm"]), ("Water level probe / controller fault", ["Low water level alarm", "High water level alarm"]),
    ("Burner management system (BMS) fault", ["Fault code displayed on HMI / panel", "Equipment failed to start"]),
    ("Gas train valve / leak-test failure", ["Equipment failed to start"]), ("Steam pressure switch / transmitter fault", ["Pressure fluctuation"])])
add(UNPLANNED, "Boilers", "Process and Utility", [
    ("Low gas pressure trip", ["Equipment tripped during operation"]), ("High TDS / poor feed water quality", ["High conductivity / TDS at outlet", "Foaming in boiler observed"]),
    ("Priming / carry-over", ["Water carryover observed", "Foaming in boiler observed"]), ("Steam pressure not building", ["Low steam pressure"]),
    ("Low condensate return", ["Condensate not returning"])])
add(UNPLANNED, "Air Compressors", "Mechanical", [
    ("Air-end failure / seizure", NOISE + TRIP), ("Intake (unloader) valve fault", ["Compressed air pressure below set point"]),
    ("Minimum pressure / check valve fault", ["Pressure fluctuation"]), ("Oil cooler / after-cooler blocked or leaking", ["High discharge temperature"] + LEAK),
    ("Oil leak / low oil level", LEAK + ["High discharge temperature"]), ("Cooling fan failure", ["High discharge temperature"])])
add(UNPLANNED, "Air Compressors", "Process and Utility", [
    ("High discharge temperature trip", ["High discharge temperature"] + TRIP), ("Oil carry-over into air line", ["Moisture in compressed air line"]),
    ("Separator element blocked", ["Compressed air pressure below set point"]), ("Air leak (compressor / receiver)", ["Compressed air pressure below set point"] + LEAK),
    ("Compressed air pressure drop", ["Compressed air pressure below set point"])])
add(UNPLANNED, "Air Compressors", "Instrumentation and Control", [
    ("Compressor controller fault", ["Fault code displayed on HMI / panel"]), ("Temperature sensor fault", TRIP), ("Pressure transducer fault", ["Pressure fluctuation"])])
add(UNPLANNED, "Air Dryers", "Mechanical", [
    ("Refrigeration compressor failure", TRIP + ["Dew point out of specification"]), ("Condenser fan failure", ["Dew point out of specification", "Overheating observed"]),
    ("Auto-drain valve stuck", ["Moisture in compressed air line"]), ("Switching / purge valve failure (desiccant)", ["Dew point out of specification"]),
    ("Pre-filter / after-filter blocked", ["Filter differential pressure high", "Compressed air pressure below set point"])])
add(UNPLANNED, "Air Dryers", "Process and Utility", [
    ("Refrigerant leak / low charge", ["Refrigerant low pressure alarm", "Dew point out of specification"]),
    ("High dew point", ["Dew point out of specification", "Moisture in compressed air line"]), ("Desiccant exhausted", ["Dew point out of specification"]),
    ("High pressure drop across dryer", ["Compressed air pressure below set point"])])
add(UNPLANNED, "Chillers", "Mechanical", [
    ("Chiller compressor failure", TRIP + NOISE), ("Refrigerant leak", ["Refrigerant low pressure alarm", "Chilled water temperature above set point"]),
    ("Chilled water pump failure", ["Low output flow", "Chilled water temperature above set point"]), ("Condenser water pump failure", TRIP),
    ("Cooling tower fan / gearbox failure", ["Cooling tower fan not running"]), ("Cooling tower fill / drift eliminator damage", ["Chilled water temperature above set point"]),
    ("Air-cooled condenser fan failure", ["Chilled water temperature above set point"]),
    ("VAM solution pump / refrigerant pump failure", TRIP), ("VAM crystallisation", ["Chilled water temperature above set point"] + TRIP),
    ("VAM vacuum loss (purge fault)", ["Chilled water temperature above set point"])])
add(UNPLANNED, "Chillers", "Process and Utility", [
    ("Low refrigerant pressure trip", ["Refrigerant low pressure alarm"]), ("High condenser pressure trip", TRIP),
    ("Low chilled water flow trip (evaporator)", ["Low output flow"]), ("Low chilled water temperature trip (freeze protection)", TRIP),
    ("Condenser / evaporator tube fouling (high approach)", ["Chilled water temperature above set point"]),
    ("Cooling tower basin low level / make-up fault", ["Tank level low"]), ("VAM high generator temperature", ["Overheating observed"]),
    ("Chilled water temperature not achieved", ["Chilled water temperature above set point"])])
add(UNPLANNED, "Chillers", "Instrumentation and Control", [
    ("Chiller controller / starter fault", ["Fault code displayed on HMI / panel"]), ("Oil pressure / oil temperature fault", TRIP)])
for equip in ("Pumps", "Jet Pumps"):
    add(UNPLANNED, equip, "Mechanical", [
        ("Pump not priming / air lock", ["Pump not priming / loss of suction"]), ("Cavitation", NOISE + ["Low output flow"]),
        ("Non-return valve failure", ["Pressure fluctuation"]), ("Strainer / suction blocked", ["Pump not priming / loss of suction", "Low output flow"]),
        ("Pump running dry", ["Pump running dry"])])
add(UNPLANNED, "Boreholes", "Mechanical", [
    ("Submersible pump failure", NOSTART + ["Low output flow"]), ("Riser pipe leak / burst", ["Low output flow", "Borehole yield dropped"]),
    ("Sand ingress / pump wear", ["Turbidity above limit", "Low output flow"])])
add(UNPLANNED, "Boreholes", "Electrical", [("Submersible cable / splice fault", NOSTART), ("Borehole panel / starter fault", NOSTART)])
add(UNPLANNED, "Boreholes", "Process and Utility", [
    ("Low yield / water table drop", ["Borehole yield dropped"]), ("High turbidity / iron", ["Turbidity above limit", "Poor water quality at outlet"])])
add(UNPLANNED, "Water Treatment", "Process and Utility", [
    ("Softener resin exhausted / regeneration failure", ["Poor water quality at outlet"]), ("Brine tank empty / salt bridge", ["Poor water quality at outlet"]),
    ("High hardness at softener outlet", ["Poor water quality at outlet"]), ("RO membrane fouling (high ΔP)", ["Low output flow", "Filter differential pressure high"]),
    ("High permeate conductivity", ["High conductivity / TDS at outlet"]), ("Low permeate flow", ["Low output flow"]),
    ("Antiscalant / chemical dosing failure", ["Poor water quality at outlet"]), ("Backwash failure", ["Filter differential pressure high"])])
add(UNPLANNED, "Water Treatment", "Mechanical", [
    ("Softener / RO control valve fault", ["Poor water quality at outlet"]), ("RO high-pressure pump trip", TRIP), ("Aeration blower failure", NOISE + TRIP)])
add(UNPLANNED, "Filtration", "Process and Utility", [
    ("Filter blocked / high ΔP", ["Filter differential pressure high", "Low output flow"]), ("Media loss / channelling", ["Turbidity above limit"]),
    ("Filter bag burst", ["Turbidity above limit"])])
add(UNPLANNED, "Filtration", "Mechanical", [("Backwash valve failure", ["Filter differential pressure high"]), ("Filter vessel leak", LEAK)])
add(UNPLANNED, "UV Systems", "Electrical", [("UV lamp failure", ["UV lamp failure alarm"]), ("UV ballast / power supply failure", ["UV lamp failure alarm"])])
add(UNPLANNED, "UV Systems", "Process and Utility", [
    ("Low UV intensity", ["UV lamp failure alarm", "Poor water quality at outlet"]), ("Quartz sleeve fouled / broken", ["UV lamp failure alarm"] + LEAK)])
add(UNPLANNED, "UV Systems", "Instrumentation and Control", [("UV intensity sensor fault", ["Fault code displayed on HMI / panel"])])
add(UNPLANNED, "Degassers", "Mechanical", [("Degasser blower failure", NOISE + TRIP), ("Packing fouled / collapsed", ["Poor water quality at outlet"]),
                                            ("Degasser transfer pump failure", ["Low output flow"])])
add(UNPLANNED, "Degassers", "Process and Utility", [("High CO₂ / low degassing efficiency", ["Poor water quality at outlet"])])
add(UNPLANNED, "Nitrogen Generators", "Process and Utility", [
    ("Low nitrogen purity", ["Fault code displayed on HMI / panel"]), ("Low nitrogen flow / pressure", ["Low output pressure", "Low output flow"]),
    ("Carbon molecular sieve (CMS) degraded", ["Low output flow"]), ("Feed air contamination (oil / moisture)", ["Moisture in compressed air line"])])
add(UNPLANNED, "Nitrogen Generators", "Instrumentation and Control", [
    ("Switching valve fault", ["Pressure fluctuation"]), ("Oxygen analyser fault", ["Fault code displayed on HMI / panel"])])
add(UNPLANNED, "Storage Tanks", "Mechanical", [
    ("Tank / receiver leak", LEAK), ("Tank corrosion", LEAK), ("Receiver safety valve passing", LEAK), ("Receiver auto-drain fault", ["Moisture in compressed air line"])])
add(UNPLANNED, "Storage Tanks", "Instrumentation and Control", [("Tank level gauge / transmitter fault", ["Tank level low", "Tank overflow"])])
add(UNPLANNED, "Distribution Systems", "Mechanical", [
    ("Pipe leak / burst", LEAK + ["Low output pressure"]), ("Steam trap failure", ["Steam leakage observed", "Condensate not returning"]),
    ("Pressure reducing valve (PRV) fault", ["Pressure fluctuation"]), ("Isolation valve failure", LEAK), ("Insulation damage", ["Steam leakage observed"]),
    ("Condensate return line blocked", ["Condensate not returning"])])
add(UNPLANNED, "Distribution Systems", "Process and Utility", [
    ("Low pressure at user point", ["Low output pressure", "Compressed air pressure below set point"]), ("Water hammer", NOISE)])
add(UNPLANNED, "General", "Electrical", [("MCC / power distribution fault", ["Loss of power to equipment"]), ("Plant generator failure", ["Loss of power to equipment"])])
add(UNPLANNED, "General", "Instrumentation and Control", [("SCADA / control room system failure", ["Fault code displayed on HMI / panel"])])

# ---------------------------------------------------------------- condition-based maintenance
CBM_CAT = "Condition Monitoring Finding"
add(CBM, None, CBM_CAT, [
    ("High vibration trend", ["Excessive vibration observed"]), ("Bearing temperature rising", ["Overheating observed"]),
    ("Abnormal noise found on inspection", ["Abnormal noise observed"]), ("Oil analysis abnormal", []), ("Thermography hot spot", ["Overheating observed"]),
    ("Leak found on inspection", LEAK), ("Performance / efficiency drop", ["Low output flow", "Low output pressure"]),
    ("Pressure drop rising (filter / strainer)", ["Filter differential pressure high"]), ("Motor insulation resistance low", []),
    ("Wear found on inspection", [])])
add(CBM, "Air Compressors", CBM_CAT, [("Separator ΔP high", ["Compressed air pressure below set point"]), ("Oil / air filter ΔP high", ["Filter differential pressure high"])])
add(CBM, "Boilers", CBM_CAT, [("Flue gas temperature high (fouling)", ["High flue gas temperature"]), ("Feed water quality out of limit", ["High conductivity / TDS at outlet"])])
add(CBM, "Chillers", CBM_CAT, [("High approach temperature (tube fouling)", ["Chilled water temperature above set point"]), ("Refrigerant level low", ["Refrigerant low pressure alarm"])])
add(CBM, "Air Dryers", CBM_CAT, [("Dew point drifting up", ["Dew point out of specification"])])
add(CBM, "UV Systems", CBM_CAT, [("UV intensity low – lamp change due", ["UV lamp failure alarm"])])
add(CBM, "Water Treatment", CBM_CAT, [("RO membrane ΔP high – CIP due", ["Filter differential pressure high"]), ("Softener outlet hardness rising", ["Poor water quality at outlet"])])
add(CBM, "Filtration", CBM_CAT, [("Filter ΔP high – backwash / replace", ["Filter differential pressure high"])])
add(CBM, "Boreholes", CBM_CAT, [("Borehole yield dropping", ["Borehole yield dropped"])])

# ---------------------------------------------------------------- planned maintenance
DONE = ["Scheduled maintenance carried out", "Equipment isolated for repairs"]
add(PLANNED, None, "Preventive Maintenance", [
    ("Daily / weekly PM", DONE), ("Monthly PM", DONE), ("Quarterly PM", DONE), ("Bi-annual PM", DONE), ("Annual PM", DONE),
    ("Running-hours service", DONE)])
add(PLANNED, None, "Overhaul / Major Service", [("Major overhaul", DONE), ("Component replacement (planned)", DONE)])
add(PLANNED, None, "Statutory / Inspection", [
    ("Statutory / insurance inspection", ["Statutory inspection carried out"]), ("Pressure vessel / hydro test", ["Statutory inspection carried out"]),
    ("Safety valve test", ["Statutory inspection carried out"]), ("Calibration exercise", DONE)])
add(PLANNED, None, "Cleaning / Descaling", [
    ("Descaling / de-fouling", DONE), ("Chemical cleaning", DONE), ("Tank cleaning", DONE), ("CIP / sanitisation", DONE)])
add(PLANNED, None, "Project / Modification", [
    ("Installation / upgrade project", DONE), ("Tie-in / modification", DONE), ("Plant-wide shutdown", DONE)])
add(PLANNED, "Air Compressors", "Overhaul / Major Service", [("Air-end overhaul", DONE), ("2,000 / 4,000 / 8,000 h service", DONE)])
add(PLANNED, "Boilers", "Statutory / Inspection", [("Annual boiler inspection (statutory)", ["Statutory inspection carried out"])])
add(PLANNED, "Boilers", "Cleaning / Descaling", [("Boiler chemical cleaning / blowdown", DONE), ("Fire-side tube cleaning", DONE)])
add(PLANNED, "Boilers", "Overhaul / Major Service", [("Refractory repair", DONE), ("Burner overhaul", DONE)])
add(PLANNED, "Chillers", "Cleaning / Descaling", [("Condenser / evaporator tube cleaning", DONE), ("Cooling tower cleaning", DONE)])
add(PLANNED, "Chillers", "Overhaul / Major Service", [("Refrigerant top-up / leak test", DONE), ("VAM solution / purge service", DONE)])
add(PLANNED, "Water Treatment", "Overhaul / Major Service", [("RO membrane replacement", DONE), ("Softener resin replacement", DONE)])
add(PLANNED, "UV Systems", "Overhaul / Major Service", [("UV lamp / sleeve replacement", DONE)])
add(PLANNED, "Filtration", "Overhaul / Major Service", [("Filter media / bag replacement", DONE)])
add(PLANNED, "Boreholes", "Overhaul / Major Service", [("Pump pulling and inspection", DONE), ("Borehole rehabilitation / flushing", DONE)])
add(PLANNED, "Nitrogen Generators", "Overhaul / Major Service", [("CMS replacement", DONE)])
add(PLANNED, "Air Dryers", "Overhaul / Major Service", [("Desiccant replacement", DONE)])

# ---------------------------------------------------------------- external supply failure
NOPOWER = ["Loss of power to equipment"]
add(EXTERNAL, None, "Power Supply", [
    ("Public power (PHCN / grid) outage", NOPOWER), ("Voltage fluctuation / dip", NOPOWER + TRIP), ("IPP / gas-turbine supply failure", NOPOWER)])
add(EXTERNAL, None, "Fuel / Gas Supply", [
    ("Natural gas supply cut", TRIP), ("Natural gas low pressure", TRIP), ("LPFO supply shortage", []), ("Diesel supply shortage", [])])
add(EXTERNAL, None, "Water Supply", [("Raw water supply shortage", ["Tank level low"]), ("Public water supply failure", ["Tank level low"])])
add(EXTERNAL, None, "Third Party", [("Vendor / contractor delay", []), ("Incident in another department (fire / safety)", ["Emergency stop activated"])])
add(EXTERNAL, None, "Weather / Environment", [("Weather / environmental event", []), ("Flooding / storm damage", [])])

GENERAL_ISSUES = ["Equipment failed to start", "Equipment tripped during operation", "Equipment shut down on alarm",
                  "Fault code displayed on HMI / panel", "Abnormal noise observed", "Excessive vibration observed", "Overheating observed",
                  "Leakage observed", "Low output pressure", "Low output flow", "High discharge temperature", "Pressure fluctuation",
                  "Flow fluctuation", "Loss of power to equipment", "Motor overload trip", "Emergency stop activated",
                  "Equipment isolated for repairs", "Equipment awaiting spare parts", "Equipment awaiting vendor attention"]

out = {"types": [UNPLANNED, CBM, PLANNED, EXTERNAL], "general_issues": GENERAL_ISSUES, "causes": rows}
(ROOT / "seed_data/downtime_causes.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
(ROOT / "supabase/seed/80_downtime_causes.sql").write_text(
    "-- Generated by scripts/build_downtime_causes.py (seed_data/downtime_causes.json)\n"
    f"select public.load_downtime_causes($json${json.dumps(out, separators=(',', ':'), ensure_ascii=False)}$json$::jsonb);\n")
print(len(rows), "causes,", len({r["equip"] for r in rows}) - 1, "equipment categories with specific causes")
