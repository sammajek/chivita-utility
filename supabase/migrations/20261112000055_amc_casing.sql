-- AMC contract names and vendors were stored in capitals (from the Excel tracker): normal casing, acronyms kept.
update public.amc_contracts
   set description = regexp_replace(initcap(description), '\mVam\M', 'VAM', 'g'),
       vendor = initcap(vendor)
 where description = upper(description) or vendor = upper(vendor);
update public.amc_contracts set description = replace(replace(replace(description, ' And ', ' and '), ' Across ', ' across '), ' Of ', ' of ');
