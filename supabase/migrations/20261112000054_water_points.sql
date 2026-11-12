-- Water Quality sampling plan (owner, 2026-11-12). Safe to run more than once; nothing is deleted (past results kept).
--  * Treated water: only "Water from utility" stays; the other treated-water points are taken off the plan.
--  * Utilities: "ETP (pre softener and post softener)" taken off the plan.
--  * Source water: "Borehole", not "Bore Hole"; Borehole 3 is decommissioned so it is no longer listed.
--  * Typo: "VAM Chiller Lithiu Bromide" -> "VAM Chiller Lithium Bromide".
update public.water_tests set active = false
 where active and ((sample_type = 'Treated water' and sampling_point <> 'Water from utility')
                   or (sample_type = 'Utilities' and sampling_point ilike 'ETP%'));
update public.water_tests set sampling_point = 'Borehole 1, 2, 4, 5, 6, 7' where sampling_point = 'Bore Hole 1,2,3,4,5,6,7';
update public.water_tests set sampling_point = replace(sampling_point, 'Bore Hole', 'Borehole') where sampling_point like '%Bore Hole%';
update public.water_tests set parameter = replace(parameter, 'Bore Hole', 'Borehole') where parameter like '%Bore Hole%';
update public.water_tests set sampling_point = 'VAM Chiller Lithium Bromide' where sampling_point = 'VAM Chiller Lithiu Bromide';
