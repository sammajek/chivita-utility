-- Water Quality categories and sampling points in title case (owner, 2026-11-12), e.g. "Source Water",
-- "RO Reject Water". Acronyms kept; small joining words lower case.
update public.water_tests
   set sample_type = initcap(sample_type),
       sampling_point = replace(replace(replace(replace(replace(replace(
                          regexp_replace(regexp_replace(regexp_replace(initcap(sampling_point), '\mRo\M', 'RO', 'g'), '\mVam\M', 'VAM', 'g'), '\mEtp\M', 'ETP', 'g'),
                          ' Into ', ' into '), ' And ', ' and '), ' From ', ' from '), ' Of ', ' of '), ' For ', ' for '), ' The ', ' the ')
 where sample_type <> initcap(sample_type) or sampling_point ~ '(^| )[a-z]' or sampling_point ~ '\m(Ro|Vam)\M';
-- Owner's names for the two main points (2026-11-12).
update public.water_tests set sampling_point = 'Water from Raw Water Storage Tank'
 where sample_type = 'Raw Water' and sampling_point in ('Inlet into Water Treatment and Water Storage Tank', 'Inlet into water treatment and water storage tank');
update public.water_tests set sampling_point = 'Water to Distribution Header'
 where sample_type = 'Treated Water' and sampling_point in ('Water from Utility', 'Water from utility');
