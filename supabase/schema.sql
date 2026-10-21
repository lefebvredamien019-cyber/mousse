-- MOUSSE — schéma Supabase initial
-- À exécuter dans Supabase > SQL Editor après création du projet.
create extension if not exists pgcrypto;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Mon commerce',
  logo_url text,
  address text,
  phone text,
  email text,
  opening_hours text,
  description text,
  theme_color text not null default '#173f32',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_cents integer not null default 0 check (price_cents >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_name text not null,
  customer_email text,
  status text not null default 'received'
    check (status in ('received','accepted','ready','collected','cancelled')),
  total_cents integer not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create table if not exists public.shop_affluence (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  status text not null default 'calme' check (status in ('calme','modere','charge')),
  note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shop_affluence enable row level security;

-- Commerçants : uniquement leur boutique et leurs données.
create policy "owner manages own shop" on public.shops
  for all to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owner manages own products" on public.products
  for all to authenticated using (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

create policy "owner manages own orders" on public.orders
  for all to authenticated using (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

create policy "owner manages own order items" on public.order_items
  for all to authenticated using (
    exists (select 1 from public.orders o join public.shops s on s.id = o.shop_id
      where o.id = order_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.orders o join public.shops s on s.id = o.shop_id
      where o.id = order_id and s.owner_id = auth.uid())
  );

create policy "owner manages own affluence" on public.shop_affluence
  for all to authenticated using (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

-- Création automatique d'une fiche commerce à l'inscription.
create or replace function public.create_shop_for_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.shops (owner_id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'shop_name', 'Mon commerce'), new.email)
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_shop on auth.users;
create trigger on_auth_user_created_create_shop
  after insert on auth.users
  for each row execute procedure public.create_shop_for_new_user();
