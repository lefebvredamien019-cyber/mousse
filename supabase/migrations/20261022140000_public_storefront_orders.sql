-- MOUSSE: public storefront and server-created order notifications.
-- Apply only after reviewing on a disposable/test Supabase project first.
begin;

alter table public.shops
  add column if not exists is_published boolean not null default false,
  add column if not exists delivery_enabled boolean not null default false,
  add column if not exists delivery_fee_cents integer not null default 0
    check (delivery_fee_cents >= 0),
  add column if not exists delivery_min_cents integer not null default 0
    check (delivery_min_cents >= 0);

alter table public.orders
  add column if not exists fulfillment text not null default 'pickup'
    check (fulfillment in ('pickup', 'delivery')),
  add column if not exists delivery_address text,
  add column if not exists delivery_note text not null default '',
  add column if not exists customer_note text not null default '',
  add column if not exists delivery_fee_cents integer not null default 0
    check (delivery_fee_cents >= 0),
  add column if not exists notification_status text not null default 'pending'
    check (notification_status in ('pending', 'sent', 'failed'));

-- Public customers can read only approved, published shop fields and active
-- product fields. Contact e-mails, owner IDs, orders, and customer data remain private.
drop policy if exists "public can read published shops" on public.shops;
create policy "public can read published shops" on public.shops
  for select to anon using (is_published = true);

drop policy if exists "public can read active products from published shops" on public.products;
create policy "public can read active products from published shops" on public.products
  for select to anon using (
    active = true and exists (
      select 1 from public.shops s
      where s.id = shop_id and s.is_published = true
    )
  );

grant select (id, name, logo_url, address, phone, description, theme_color,
              delivery_enabled, delivery_fee_cents, delivery_min_cents, is_published)
  on public.shops to anon;
grant select (id, shop_id, name, description, price_cents, stock, image_url, active)
  on public.products to anon;

-- Hashed client identifiers are retained briefly for public order rate limiting.
create table if not exists public.order_rate_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);
alter table public.order_rate_limits enable row level security;
revoke all on public.order_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.order_rate_limits to service_role;

create or replace function public.consume_order_rate_limit(
  p_bucket text, p_limit integer default 5, p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_bucket is null or length(p_bucket) < 32
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit request';
  end if;

  insert into public.order_rate_limits (bucket, window_started_at, attempt_count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set attempt_count = case
          when public.order_rate_limits.window_started_at
               <= now() - make_interval(secs => p_window_seconds) then 1
          else public.order_rate_limits.attempt_count + 1
        end,
        window_started_at = case
          when public.order_rate_limits.window_started_at
               <= now() - make_interval(secs => p_window_seconds) then now()
          else public.order_rate_limits.window_started_at
        end
  returning attempt_count into v_attempts;

  return v_attempts <= p_limit;
end;
$$;
revoke all on function public.consume_order_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_order_rate_limit(text, integer, integer)
  to service_role;

-- Order prices and shop delivery settings are read from the database, never
-- trusted from the browser. Stock is reserved atomically with order creation.
create or replace function public.create_customer_order(
  p_shop_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_fulfillment text,
  p_delivery_address text,
  p_delivery_note text,
  p_customer_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop record;
  v_item jsonb;
  v_line jsonb;
  v_product record;
  v_quantity integer;
  v_subtotal bigint := 0;
  v_delivery_fee bigint := 0;
  v_total bigint := 0;
  v_order_id uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_customer_name is null or length(trim(p_customer_name)) < 2
     or length(p_customer_name) > 120 then
    raise exception 'Invalid customer name';
  end if;
  if p_customer_email is not null and
     (length(p_customer_email) > 254 or
      p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
    raise exception 'Invalid customer e-mail';
  end if;
  if p_fulfillment is null or p_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Invalid fulfillment method';
  end if;
  if p_fulfillment = 'delivery' and
     (p_delivery_address is null or length(trim(p_delivery_address)) < 5
      or length(p_delivery_address) > 300) then
    raise exception 'A delivery address is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid order items';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Invalid order items';
  end if;

  select s.id, s.name, s.email, s.is_published, s.delivery_enabled,
         s.delivery_fee_cents, s.delivery_min_cents
    into v_shop
    from public.shops s
   where s.id = p_shop_id;

  if not found or not v_shop.is_published then
    raise exception 'Shop is unavailable';
  end if;
  if v_shop.email is null or length(trim(v_shop.email)) > 254
     or v_shop.email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+
    raise exception 'Shop notification e-mail is not configured';
  end if;
  if p_fulfillment = 'delivery' and not v_shop.delivery_enabled then
    raise exception 'Delivery is not available for this shop';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'product_id') is null
       or (v_item ->> 'quantity') is null
       or (v_item ->> 'quantity') !~ '^[0-9]+$' then
      raise exception 'Invalid order item';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid item quantity';
    end if;

    select p.id, p.shop_id, p.name, p.price_cents, p.stock
      into v_product
      from public.products p
     where p.id = (v_item ->> 'product_id')::uuid
       and p.shop_id = p_shop_id
       and p.active = true
     for update;

    if not found then
      raise exception 'A product is unavailable';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    update public.products p
       set stock = p.stock - v_quantity
     where p.id = v_product.id;

    v_subtotal := v_subtotal + (v_product.price_cents::bigint * v_quantity::bigint);
    if v_subtotal > 2000000000 then
      raise exception 'Order total exceeds the test checkout limit';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price_cents', v_product.price_cents
    ));
  end loop;

  if p_fulfillment = 'delivery' and v_subtotal < v_shop.delivery_min_cents then
    raise exception 'Order is below the shop delivery minimum';
  end if;
  if p_fulfillment = 'delivery' then
    v_delivery_fee := v_shop.delivery_fee_cents;
  end if;
  v_total := v_subtotal + v_delivery_fee;
  if v_total > 2147483647 then
    raise exception 'Order total exceeds the supported limit';
  end if;

  insert into public.orders
    (shop_id, customer_name, customer_email, status, total_cents,
     fulfillment, delivery_address, delivery_note, customer_note, delivery_fee_cents)
  values
    (p_shop_id, trim(p_customer_name), nullif(trim(p_customer_email), ''),
     'received', v_total, p_fulfillment, nullif(trim(p_delivery_address), ''),
     left(coalesce(p_delivery_note, ''), 500), left(coalesce(p_customer_note, ''), 500),
     v_delivery_fee)
  returning id into v_order_id;

  -- Persist the server-priced item snapshot under the new order.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items
      (order_id, product_id, product_name, quantity, unit_price_cents)
    values
      (v_order_id, (v_line ->> 'product_id')::uuid,
       v_line ->> 'name', (v_line ->> 'quantity')::integer,
       (v_line ->> 'unit_price_cents')::integer);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'shop_name', v_shop.name,
    'shop_email', v_shop.email,
    'customer_name', trim(p_customer_name),
    'fulfillment', p_fulfillment,
    'delivery_address', nullif(trim(p_delivery_address), ''),
    'delivery_note', left(coalesce(p_delivery_note, ''), 500),
    'customer_note', left(coalesce(p_customer_note, ''), 500),
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'total_cents', v_total,
    'items', v_lines
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) to service_role;

commit;
 then
    raise exception 'Shop notification e-mail is not configured';
  end if;
  if p_fulfillment = 'delivery' and not v_shop.delivery_enabled then
    raise exception 'Delivery is not available for this shop';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'product_id') is null
       or (v_item ->> 'quantity') is null
       or (v_item ->> 'quantity') !~ '^[0-9]+$' then
      raise exception 'Invalid order item';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid item quantity';
    end if;

    select p.id, p.shop_id, p.name, p.price_cents, p.stock
      into v_product
      from public.products p
     where p.id = (v_item ->> 'product_id')::uuid
       and p.shop_id = p_shop_id
       and p.active = true
     for update;

    if not found then
      raise exception 'A product is unavailable';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    update public.products p
       set stock = p.stock - v_quantity
     where p.id = v_product.id;

    v_subtotal := v_subtotal + (v_product.price_cents * v_quantity);
    if v_subtotal > 100000000 then
      raise exception 'Order total exceeds the test checkout limit';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price_cents', v_product.price_cents
    ));
  end loop;

  if p_fulfillment = 'delivery' and v_subtotal < v_shop.delivery_min_cents then
    raise exception 'Order is below the shop delivery minimum';
  end if;
  if p_fulfillment = 'delivery' then
    v_delivery_fee := v_shop.delivery_fee_cents;
  end if;
  v_total := v_subtotal + v_delivery_fee;

  insert into public.orders
    (shop_id, customer_name, customer_email, status, total_cents,
     fulfillment, delivery_address, delivery_note, customer_note, delivery_fee_cents)
  values
    (p_shop_id, trim(p_customer_name), nullif(trim(p_customer_email), ''),
     'received', v_total, p_fulfillment, nullif(trim(p_delivery_address), ''),
     left(coalesce(p_delivery_note, ''), 500), left(coalesce(p_customer_note, ''), 500),
     v_delivery_fee)
  returning id into v_order_id;

  -- Persist the server-priced item snapshot under the new order.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items
      (order_id, product_id, product_name, quantity, unit_price_cents)
    values
      (v_order_id, (v_line ->> 'product_id')::uuid,
       v_line ->> 'name', (v_line ->> 'quantity')::integer,
       (v_line ->> 'unit_price_cents')::integer);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'shop_name', v_shop.name,
    'shop_email', v_shop.email,
    'customer_name', trim(p_customer_name),
    'fulfillment', p_fulfillment,
    'delivery_address', nullif(trim(p_delivery_address), ''),
    'delivery_note', left(coalesce(p_delivery_note, ''), 500),
    'customer_note', left(coalesce(p_customer_note, ''), 500),
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'total_cents', v_total,
    'items', v_lines
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) to service_role;

commit;
 then
    raise exception 'Shop notification e-mail is not configured';
  end if;
  if p_fulfillment = 'delivery' and not v_shop.delivery_enabled then
    raise exception 'Delivery is not available for this shop';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'product_id') is null
       or (v_item ->> 'quantity') is null
       or (v_item ->> 'quantity') !~ '^[0-9]+$' then
      raise exception 'Invalid order item';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid item quantity';
    end if;

    select p.id, p.shop_id, p.name, p.price_cents, p.stock
      into v_product
      from public.products p
     where p.id = (v_item ->> 'product_id')::uuid
       and p.shop_id = p_shop_id
       and p.active = true
     for update;

    if not found then
      raise exception 'A product is unavailable';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    update public.products p
       set stock = p.stock - v_quantity
     where p.id = v_product.id;

    v_subtotal := v_subtotal + (v_product.price_cents::bigint * v_quantity::bigint);
    if v_subtotal > 2000000000 then
      raise exception 'Order total exceeds the test checkout limit';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price_cents', v_product.price_cents
    ));
  end loop;

  if p_fulfillment = 'delivery' and v_subtotal < v_shop.delivery_min_cents then
    raise exception 'Order is below the shop delivery minimum';
  end if;
  if p_fulfillment = 'delivery' then
    v_delivery_fee := v_shop.delivery_fee_cents;
  end if;
  v_total := v_subtotal + v_delivery_fee;
  if v_total > 2147483647 then
    raise exception 'Order total exceeds the supported limit';
  end if;

  insert into public.orders
    (shop_id, customer_name, customer_email, status, total_cents,
     fulfillment, delivery_address, delivery_note, customer_note, delivery_fee_cents)
  values
    (p_shop_id, trim(p_customer_name), nullif(trim(p_customer_email), ''),
     'received', v_total, p_fulfillment, nullif(trim(p_delivery_address), ''),
     left(coalesce(p_delivery_note, ''), 500), left(coalesce(p_customer_note, ''), 500),
     v_delivery_fee)
  returning id into v_order_id;

  -- Persist the server-priced item snapshot under the new order.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items
      (order_id, product_id, product_name, quantity, unit_price_cents)
    values
      (v_order_id, (v_line ->> 'product_id')::uuid,
       v_line ->> 'name', (v_line ->> 'quantity')::integer,
       (v_line ->> 'unit_price_cents')::integer);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'shop_name', v_shop.name,
    'shop_email', v_shop.email,
    'customer_name', trim(p_customer_name),
    'fulfillment', p_fulfillment,
    'delivery_address', nullif(trim(p_delivery_address), ''),
    'delivery_note', left(coalesce(p_delivery_note, ''), 500),
    'customer_note', left(coalesce(p_customer_note, ''), 500),
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'total_cents', v_total,
    'items', v_lines
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) to service_role;

commit;
 then
    raise exception 'Shop notification e-mail is not configured';
  end if;
  if p_fulfillment = 'delivery' and not v_shop.delivery_enabled then
    raise exception 'Delivery is not available for this shop';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'product_id') is null
       or (v_item ->> 'quantity') is null
       or (v_item ->> 'quantity') !~ '^[0-9]+$' then
      raise exception 'Invalid order item';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid item quantity';
    end if;

    select p.id, p.shop_id, p.name, p.price_cents, p.stock
      into v_product
      from public.products p
     where p.id = (v_item ->> 'product_id')::uuid
       and p.shop_id = p_shop_id
       and p.active = true
     for update;

    if not found then
      raise exception 'A product is unavailable';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    update public.products p
       set stock = p.stock - v_quantity
     where p.id = v_product.id;

    v_subtotal := v_subtotal + (v_product.price_cents * v_quantity);
    if v_subtotal > 100000000 then
      raise exception 'Order total exceeds the test checkout limit';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price_cents', v_product.price_cents
    ));
  end loop;

  if p_fulfillment = 'delivery' and v_subtotal < v_shop.delivery_min_cents then
    raise exception 'Order is below the shop delivery minimum';
  end if;
  if p_fulfillment = 'delivery' then
    v_delivery_fee := v_shop.delivery_fee_cents;
  end if;
  v_total := v_subtotal + v_delivery_fee;

  insert into public.orders
    (shop_id, customer_name, customer_email, status, total_cents,
     fulfillment, delivery_address, delivery_note, customer_note, delivery_fee_cents)
  values
    (p_shop_id, trim(p_customer_name), nullif(trim(p_customer_email), ''),
     'received', v_total, p_fulfillment, nullif(trim(p_delivery_address), ''),
     left(coalesce(p_delivery_note, ''), 500), left(coalesce(p_customer_note, ''), 500),
     v_delivery_fee)
  returning id into v_order_id;

  -- Persist the server-priced item snapshot under the new order.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items
      (order_id, product_id, product_name, quantity, unit_price_cents)
    values
      (v_order_id, (v_line ->> 'product_id')::uuid,
       v_line ->> 'name', (v_line ->> 'quantity')::integer,
       (v_line ->> 'unit_price_cents')::integer);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'shop_name', v_shop.name,
    'shop_email', v_shop.email,
    'customer_name', trim(p_customer_name),
    'fulfillment', p_fulfillment,
    'delivery_address', nullif(trim(p_delivery_address), ''),
    'delivery_note', left(coalesce(p_delivery_note, ''), 500),
    'customer_note', left(coalesce(p_customer_note, ''), 500),
    'subtotal_cents', v_subtotal,
    'delivery_fee_cents', v_delivery_fee,
    'total_cents', v_total,
    'items', v_lines
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
) to service_role;

commit;
