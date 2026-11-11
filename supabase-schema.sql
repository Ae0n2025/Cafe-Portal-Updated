-- Run this file in the Supabase SQL Editor before connecting the customer page.
-- Customers sign in with Supabase email/password. Staff access is granted by
-- adding approved auth user IDs to public.staff_members.

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default 'Alex Rivera',
    email text,
    language text not null default 'en' check (language in ('en', 'fil')),
    dark_mode boolean not null default false,
    updated_at timestamptz not null default now()
);

create table if not exists public.staff_members (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
    id text primary key,
    name text not null,
    description text not null default '',
    category text not null check (category in ('meals', 'drinks', 'snacks')),
    price numeric(10, 2) not null check (price >= 0),
    image_url text not null default '',
    is_available boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.orders (
    id bigint generated always as identity primary key,
    order_number text generated always as ('CP-' || lpad(id::text, 6, '0')) stored unique,
    customer_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
    payment_method text not null
        check (payment_method in ('cash', 'gcash', 'maya', 'bank')),
    total numeric(10, 2) not null check (total >= 0),
    created_at timestamptz not null default now()
);

create table if not exists public.order_items (
    id bigint generated always as identity primary key,
    order_id bigint not null references public.orders(id) on delete cascade,
    product_id text not null references public.menu_items(id),
    item_name text not null,
    unit_price numeric(10, 2) not null check (unit_price >= 0),
    quantity integer not null check (quantity between 1 and 20)
);

create or replace function public.create_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), 'Alex Rivera')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_customer_auth_user_created on auth.users;
create trigger on_customer_auth_user_created
    after insert on auth.users
    for each row execute function public.create_customer_profile();

alter table public.profiles enable row level security;
alter table public.staff_members enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Customers can read their profile" on public.profiles;
create policy "Customers can read their profile"
    on public.profiles for select to authenticated
    using ((select auth.uid()) = id);
drop policy if exists "Customers can create their profile" on public.profiles;
create policy "Customers can create their profile"
    on public.profiles for insert to authenticated
    with check ((select auth.uid()) = id);
drop policy if exists "Customers can update their profile" on public.profiles;
create policy "Customers can update their profile"
    on public.profiles for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

drop policy if exists "Staff can read own membership" on public.staff_members;
create policy "Staff can read own membership"
    on public.staff_members for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read available menu items" on public.menu_items;
create policy "Anyone can read available menu items"
    on public.menu_items for select to anon, authenticated
    using (is_available);

drop policy if exists "Customers can read their orders" on public.orders;
create policy "Customers can read their orders"
    on public.orders for select to authenticated
    using ((select auth.uid()) = customer_id);

drop policy if exists "Customers can read their order items" on public.order_items;
create policy "Customers can read their order items"
    on public.order_items for select to authenticated
    using (
        exists (
            select 1
            from public.orders
            where orders.id = order_items.order_id
              and orders.customer_id = (select auth.uid())
        )
    );

grant select on public.menu_items to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.staff_members to authenticated;
grant select on public.orders, public.order_items to authenticated;

create or replace function public.place_customer_order(
    p_payment_method text,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    customer uuid := auth.uid();
    item record;
    new_order public.orders%rowtype;
    order_total numeric(10, 2);
    requested_count integer;
    matched_count integer;
begin
    if customer is null then
        raise exception 'A signed-in customer session is required.';
    end if;

    if p_payment_method is null or p_payment_method not in ('cash', 'gcash', 'maya', 'bank') then
        raise exception 'Unsupported payment method.';
    end if;

    if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'The order must contain at least one item.';
    end if;

    select count(*) into requested_count
    from jsonb_to_recordset(p_items) as requested(product_id text, quantity integer);

    if exists (
        select 1
        from jsonb_to_recordset(p_items) as requested(product_id text, quantity integer)
        where requested.quantity is null or requested.quantity < 1 or requested.quantity > 20
    ) then
        raise exception 'Item quantities must be between 1 and 20.';
    end if;

    select count(*), coalesce(sum(menu.price * requested.quantity), 0)
    into matched_count, order_total
    from jsonb_to_recordset(p_items) as requested(product_id text, quantity integer)
    join public.menu_items as menu
      on menu.id = requested.product_id
     and menu.is_available;

    if matched_count <> requested_count then
        raise exception 'One or more menu items are unavailable.';
    end if;

    insert into public.orders (customer_id, payment_method, total)
    values (customer, p_payment_method, order_total)
    returning * into new_order;

    for item in
        select menu.id, menu.name, menu.price, requested.quantity
        from jsonb_to_recordset(p_items) as requested(product_id text, quantity integer)
        join public.menu_items as menu
          on menu.id = requested.product_id
         and menu.is_available
    loop
        insert into public.order_items (order_id, product_id, item_name, unit_price, quantity)
        values (new_order.id, item.id, item.name, item.price, item.quantity);
    end loop;

    return jsonb_build_object(
        'id', new_order.id,
        'order_number', new_order.order_number,
        'status', new_order.status,
        'payment_method', new_order.payment_method,
        'total', new_order.total,
        'created_at', new_order.created_at
    );
end;
$$;

revoke all on function public.place_customer_order(text, jsonb) from public;
grant execute on function public.place_customer_order(text, jsonb) to authenticated;

insert into public.menu_items (id, name, description, category, price, image_url)
values
    ('chicken-teriyaki-bowl', 'Chicken Teriyaki Bowl',
     'Glazed chicken, steamed rice, egg, and fresh vegetables.', 'meals', 145,
     'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=600'),
    ('caramel-iced-latte', 'Caramel Iced Latte',
     'Espresso, creamy milk, caramel, and ice.', 'drinks', 95,
     'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&q=80&w=600'),
    ('chocolate-croissant', 'Chocolate Croissant',
     'Buttery pastry with a rich chocolate center.', 'snacks', 75,
     'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&q=80&w=600')
on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    price = excluded.price,
    image_url = excluded.image_url;
