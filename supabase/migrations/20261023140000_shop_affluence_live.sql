alter table public.shop_affluence
  drop constraint if exists shop_affluence_status_check;

alter table public.shop_affluence
  add constraint shop_affluence_status_check
  check (status = any (array['calme'::text, 'modere'::text, 'charge'::text, 'ferme'::text));

create unique index if not exists shop_affluence_shop_id_uidx
  on public.shop_affluence (shop_id);

drop policy if exists "public can read published shop affluence" on public.shop_affluence;
create policy "public can read published shop affluence"
  on public.shop_affluence
  for select
  to anon
  using (
    exists (
      select 1 from public.shops s
      where s.id = shop_affluence.shop_id
        and s.is_published = true
    )
  );

grant select on public.shop_affluence to anon;
