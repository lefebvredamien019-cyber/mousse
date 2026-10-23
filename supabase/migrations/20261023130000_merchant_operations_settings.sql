-- MOUSSE merchant operations settings and server-side checkout safeguards.
begin;

alter table public.shops
  add column if not exists shop_template text not null default 'classic'
    check (shop_template in ('restaurant','services','classic','hybrid')),
  add column if not exists order_paused boolean not null default false,
  add column if not exists pause_message text not null default '',
  add column if not exists pause_return_at timestamptz,
  add column if not exists delivery_radius_km integer
    check (delivery_radius_km is null or delivery_radius_km between 1 and 200),
  add column if not exists delivery_postcodes text[] not null default '{}',
  add column if not exists response_deadline_minutes integer not null default 30
    check (response_deadline_minutes between 5 and 1440),
  add column if not exists reminder_minutes integer not null default 10
    check (reminder_minutes between 1 and 1439);

-- Public storefront can read only the non-sensitive delivery/status fields it needs.
grant select (shop_template, order_paused, pause_message, pause_return_at,
              delivery_postcodes, delivery_radius_km)
  on public.shops to anon;

-- A shop owner must not be able to publish their own listing by calling the API directly.
create or replace function public.prevent_owner_self_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() = old.owner_id
     and new.is_published is distinct from old.is_published then
    raise exception 'Shop publication requires MOUSSE review';
  end if;
  return new;
end;
$$;

drop trigger if exists shops_prevent_owner_self_publication on public.shops;
create trigger shops_prevent_owner_self_publication
before update of is_published on public.shops
for each row execute function public.prevent_owner_self_publication();

-- Enforce order pause and configured postal-code delivery zones at the database boundary,
-- so bypassing the browser UI cannot bypass these settings.
create or replace function public.enforce_shop_order_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop record;
  v_postcode text;
begin
  select s.order_paused, s.pause_message, s.delivery_enabled, s.delivery_postcodes
    into v_shop
    from public.shops s
   where s.id = new.shop_id;

  if not found then
    raise exception 'Shop is unavailable';
  end if;
  if v_shop.order_paused then
    raise exception 'This shop is temporarily not accepting orders';
  end if;
  if new.fulfillment = 'delivery' then
    if not v_shop.delivery_enabled then
      raise exception 'Delivery is not available for this shop';
    end if;
    if coalesce(array_length(v_shop.delivery_postcodes, 1), 0) > 0 then
      v_postcode := substring(coalesce(new.delivery_address, '') from '([0-9]{5})');
      if v_postcode is null or not (v_postcode = any(v_shop.delivery_postcodes)) then
        raise exception 'Delivery address is outside the shop delivery zone';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_shop_order_settings on public.orders;
create trigger orders_enforce_shop_order_settings
before insert on public.orders
for each row execute function public.enforce_shop_order_settings();

commit;
