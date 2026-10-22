-- Customer delivery notifications and merchant-managed order lifecycle.
-- Apply after the storefront order migration on the test project.
begin;

alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists notification_channel text not null default 'email'
    check (notification_channel in ('email', 'sms')),
  add column if not exists tracking_number text,
  add column if not exists customer_notification_status text not null default 'pending'
    check (customer_notification_status in ('pending', 'sent', 'failed'));

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('received', 'accepted', 'preparing', 'ready', 'shipped',
                    'in_delivery', 'delivered', 'collected', 'cancelled'));

-- Orders are read-only to merchant browser clients. Changes go through the
-- authenticated status RPC so stock and customer notifications remain paired.
revoke insert, update, delete on public.orders, public.order_items from authenticated;
grant select on public.orders, public.order_items to authenticated;

-- Replace the test checkout RPC with a version that requires one customer
-- notification route, while keeping prices and stock server-authoritative.
drop function if exists public.create_customer_order(
  uuid, text, text, text, text, text, text, jsonb
);

create or replace function public.create_customer_order(
  p_shop_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_notification_channel text,
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
  v_customer_email text := nullif(trim(p_customer_email), '');
  v_customer_phone text := nullif(trim(p_customer_phone), '');
begin
  if p_customer_name is null or length(trim(p_customer_name)) < 2
     or length(p_customer_name) > 120 then
    raise exception 'Invalid customer name';
  end if;
  if p_notification_channel = 'email' then
    if v_customer_email is null or length(v_customer_email) > 254
       or v_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+'
       or v_customer_email ~ '[[:space:]]' then
      raise exception 'A valid customer e-mail is required';
    end if;
    v_customer_phone := null;
  elsif p_notification_channel = 'sms' then
    if v_customer_phone is null or length(v_customer_phone) < 9
       or length(v_customer_phone) > 16
       or v_customer_phone !~ '^[+][1-9][0-9]{7,14}'
       or v_customer_phone ~ '[^+0-9]' then
      raise exception 'A phone number in international format is required';
    end if;
    v_customer_email := null;
  else
    raise exception 'Choose e-mail or SMS notifications';
  end if;
  if p_fulfillment is null or p_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Invalid fulfillment method';
  end if;
  if p_fulfillment = 'delivery' and
     (p_delivery_address is null or length(trim(p_delivery_address)) < 5
      or length(p_delivery_address) > 300) then
    raise exception 'A delivery address is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
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
     or v_shop.email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+'
     or v_shop.email ~ '[[:space:]]' then
    raise exception 'Shop notification e-mail is not configured';
  end if;
  if p_fulfillment = 'delivery' and not v_shop.delivery_enabled then
    raise exception 'Delivery is not available for this shop';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'product_id') is null or (v_item ->> 'quantity') is null
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

    update public.products p set stock = p.stock - v_quantity
     where p.id = v_product.id;

    v_subtotal := v_subtotal + (v_product.price_cents::bigint * v_quantity::bigint);
    if v_subtotal > 2000000000 then
      raise exception 'Order total exceeds the test checkout limit';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'name', v_product.name,
      'quantity', v_quantity, 'unit_price_cents', v_product.price_cents
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
    (shop_id, customer_name, customer_email, customer_phone, notification_channel,
     status, total_cents, fulfillment, delivery_address, delivery_note,
     customer_note, delivery_fee_cents)
  values
    (p_shop_id, trim(p_customer_name), v_customer_email, v_customer_phone,
     p_notification_channel, 'received', v_total, p_fulfillment,
     nullif(trim(p_delivery_address), ''), left(coalesce(p_delivery_note, ''), 500),
     left(coalesce(p_customer_note, ''), 500), v_delivery_fee)
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items
      (order_id, product_id, product_name, quantity, unit_price_cents)
    values
      (v_order_id, (v_line ->> 'product_id')::uuid, v_line ->> 'name',
       (v_line ->> 'quantity')::integer, (v_line ->> 'unit_price_cents')::integer);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id, 'shop_name', v_shop.name, 'shop_email', v_shop.email,
    'customer_name', trim(p_customer_name), 'customer_email', v_customer_email,
    'customer_phone', v_customer_phone, 'notification_channel', p_notification_channel,
    'fulfillment', p_fulfillment,
    'delivery_address', nullif(trim(p_delivery_address), ''),
    'delivery_note', left(coalesce(p_delivery_note, ''), 500),
    'customer_note', left(coalesce(p_customer_note, ''), 500),
    'subtotal_cents', v_subtotal, 'delivery_fee_cents', v_delivery_fee,
    'total_cents', v_total, 'items', v_lines
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, text, text, text, text, text, text, text, text, jsonb
) to service_role;

-- Change an order only for its owning shop. Cancelling after a reservation
-- restores stock exactly once. Repeating the current status permits a failed
-- customer notification to be resent without changing the order again.
create or replace function public.update_merchant_order_status(
  p_order_id uuid,
  p_status text,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_next_tracking text := nullif(left(trim(coalesce(p_tracking_number, '')), 120), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_status not in ('preparing', 'ready', 'shipped', 'in_delivery',
                      'delivered', 'collected', 'cancelled') then
    raise exception 'Invalid order status';
  end if;

  select o.id, o.shop_id, o.status, o.fulfillment, o.customer_name,
         o.customer_email, o.customer_phone, o.notification_channel,
         o.tracking_number, s.name as shop_name
    into v_order
    from public.orders o
    join public.shops s on s.id = o.shop_id
   where o.id = p_order_id and s.owner_id = auth.uid()
   for update of o;

  if not found then
    raise exception 'Order not found for this shop';
  end if;

  if p_status <> v_order.status then
    if not (
      (v_order.status in ('received', 'accepted') and p_status in ('preparing', 'cancelled'))
      or (v_order.status = 'preparing' and
          ((v_order.fulfillment = 'pickup' and p_status in ('ready', 'cancelled'))
           or (v_order.fulfillment = 'delivery' and p_status in ('shipped', 'in_delivery', 'cancelled'))))
      or (v_order.status = 'ready' and p_status in ('collected', 'cancelled'))
      or (v_order.status in ('shipped', 'in_delivery') and p_status = 'delivered')
    ) then
      raise exception 'This order status transition is not allowed';
    end if;
  end if;

  if p_status = 'shipped' and v_next_tracking is null then
    v_next_tracking := v_order.tracking_number;
  end if;
  if p_status = 'shipped' and v_next_tracking is null then
    raise exception 'Add a tracking number before marking the order shipped';
  end if;

  if p_status = 'cancelled' and v_order.status <> 'cancelled' then
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = p_order_id
       and oi.product_id = p.id
       and p.shop_id = v_order.shop_id
       and p.stock <= 2147483647 - oi.quantity;
  end if;

  update public.orders o
     set status = p_status,
         tracking_number = coalesce(v_next_tracking, o.tracking_number),
         customer_notification_status = 'pending'
   where o.id = p_order_id;

  select o.id, o.status, o.tracking_number, o.customer_name, o.customer_email,
         o.customer_phone, o.notification_channel, o.fulfillment, s.name as shop_name
    into v_order
    from public.orders o join public.shops s on s.id = o.shop_id
   where o.id = p_order_id;

  return jsonb_build_object(
    'order_id', v_order.id, 'status', v_order.status,
    'tracking_number', v_order.tracking_number,
    'customer_name', v_order.customer_name, 'customer_email', v_order.customer_email,
    'customer_phone', v_order.customer_phone,
    'notification_channel', v_order.notification_channel,
    'fulfillment', v_order.fulfillment, 'shop_name', v_order.shop_name
  );
end;
$$;

revoke all on function public.update_merchant_order_status(uuid, text, text)
  from public, anon;
grant execute on function public.update_merchant_order_status(uuid, text, text)
  to authenticated;

commit;
