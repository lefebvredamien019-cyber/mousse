-- Provision a client profile for every Auth user and create merchant shops only for merchant signups.
create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon, authenticated;
grant select, update on public.customer_profiles to authenticated;

drop policy if exists "Users can read own customer profile" on public.customer_profiles;
create policy "Users can read own customer profile"
  on public.customer_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can update own customer profile" on public.customer_profiles;
create policy "Users can update own customer profile"
  on public.customer_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Backfill current Auth users without deleting or modifying existing shops.
insert into public.customer_profiles (user_id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.create_shop_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.customer_profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  if new.raw_user_meta_data ->> 'account_type' = 'merchant'
     and length(trim(coalesce(new.raw_user_meta_data ->> 'shop_name', ''))) >= 2 then
    insert into public.shops (owner_id, name, email)
    values (new.id, trim(new.raw_user_meta_data ->> 'shop_name'), new.email)
    on conflict (owner_id) do nothing;
  end if;

  return new;
end;
$function$;
