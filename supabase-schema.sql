-- table for the accounts and Foods DataBAse

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

create or replace function public.add_staff_member_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_user_id uuid;
begin
    if nullif(btrim(p_email), '') is null then
        raise exception 'Provide the email address of an existing Supabase Auth user.';
    end if;

    select users.id
    into strict staff_user_id
    from auth.users as users
    where lower(users.email) = lower(btrim(p_email));

    insert into public.staff_members (user_id)
    values (staff_user_id)
    on conflict (user_id) do nothing;

    return staff_user_id;
exception
    when no_data_found then
        raise exception 'No Supabase Auth user was found for email %.', p_email;
end;
$$;

revoke all on function public.add_staff_member_by_email(text) from public;
revoke all on function public.add_staff_member_by_email(text) from anon, authenticated;
grant execute on function public.add_staff_member_by_email(text) to service_role;

create table if not exists public.menu_items (
    id text primary key,
    name text not null,
    description text not null default '',
    category text not null,
    price numeric(10, 2) not null check (price >= 0),
    image_url text not null default '',
    is_available boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.menu_items
    drop constraint if exists menu_items_category_check;
alter table public.menu_items
    add constraint menu_items_category_check
    check (category ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create table if not exists public.menu_categories (
    id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text not null
);

insert into public.menu_categories (id, name)
values ('meals', 'Meals'), ('drinks', 'Drinks'), ('snacks', 'Snacks')
on conflict (id) do update set name = excluded.name;

create table if not exists public.orders (
    id bigint generated always as identity primary key,
    order_number text generated always as ('CP-' || lpad(id::text, 6, '0')) stored unique,
    customer_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
    cancellation_reason text,
    payment_method text not null
        check (payment_method in ('cash', 'gcash', 'maya', 'bank')),
    total numeric(10, 2) not null check (total >= 0),
    created_at timestamptz not null default now()
);

alter table public.orders
    add column if not exists cancellation_reason text;

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
alter table public.menu_categories enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Customers can read their profile" on public.profiles;
create policy "Customers can read their profile"
    on public.profiles for select to authenticated
    using ((select auth.uid()) = id);
drop policy if exists "Staff can read customer profiles" on public.profiles;
create policy "Staff can read customer profiles"
    on public.profiles for select to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));
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
drop policy if exists "Staff can read all menu items" on public.menu_items;
create policy "Staff can read all menu items"
    on public.menu_items for select to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));
drop policy if exists "Staff can add menu items" on public.menu_items;
create policy "Staff can add menu items"
    on public.menu_items for insert to authenticated
    with check (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));
drop policy if exists "Staff can update menu items" on public.menu_items;
create policy "Staff can update menu items"
    on public.menu_items for update to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));

drop policy if exists "Anyone can read menu categories" on public.menu_categories;
create policy "Anyone can read menu categories"
    on public.menu_categories for select to anon, authenticated
    using (true);
drop policy if exists "Staff can add menu categories" on public.menu_categories;
create policy "Staff can add menu categories"
    on public.menu_categories for insert to authenticated
    with check (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));

drop policy if exists "Customers can read their orders" on public.orders;
create policy "Customers can read their orders"
    on public.orders for select to authenticated
    using ((select auth.uid()) = customer_id);
drop policy if exists "Staff can read all orders" on public.orders;
create policy "Staff can read all orders"
    on public.orders for select to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));
drop policy if exists "Staff can update all orders" on public.orders;
create policy "Staff can update all orders"
    on public.orders for update to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));

create or replace function public.cancel_customer_order(
    p_order_id bigint,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    customer uuid := auth.uid();
    cancelled_order public.orders%rowtype;
begin
    if customer is null then
        raise exception 'A signed-in customer session is required.';
    end if;

    if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 300 then
        raise exception 'Provide a cancellation reason of 1 to 300 characters.';
    end if;

    update public.orders
    set status = 'cancelled',
        cancellation_reason = btrim(p_reason)
    where public.orders.id = p_order_id
      and public.orders.customer_id = customer
      and public.orders.status = 'pending'
    returning * into cancelled_order;

    if not found then
        raise exception 'This order can no longer be cancelled. It may already be preparing or complete.';
    end if;

    return jsonb_build_object(
        'id', cancelled_order.id,
        'order_number', cancelled_order.order_number,
        'status', cancelled_order.status,
        'cancellation_reason', cancelled_order.cancellation_reason
    );
end;
$$;

revoke all on function public.cancel_customer_order(bigint, text) from public;
grant execute on function public.cancel_customer_order(bigint, text) to authenticated;

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
drop policy if exists "Staff can read all order items" on public.order_items;
create policy "Staff can read all order items"
    on public.order_items for select to authenticated
    using (exists (
        select 1 from public.staff_members
        where staff_members.user_id = (select auth.uid())
    ));

grant select on public.menu_items to anon, authenticated;
grant insert, update on public.menu_items to authenticated;
grant select on public.menu_categories to anon, authenticated;
grant insert on public.menu_categories to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.staff_members to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;

insert into storage.buckets (id, name, public)
values ('menu-item-photos', 'menu-item-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Anyone can view menu item photos" on storage.objects;
create policy "Anyone can view menu item photos"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'menu-item-photos');
drop policy if exists "Staff can upload menu item photos" on storage.objects;
create policy "Staff can upload menu item photos"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'menu-item-photos'
        and exists (
            select 1 from public.staff_members
            where staff_members.user_id = (select auth.uid())
        )
    );
drop policy if exists "Staff can update menu item photos" on storage.objects;
create policy "Staff can update menu item photos"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'menu-item-photos'
        and exists (
            select 1 from public.staff_members
            where staff_members.user_id = (select auth.uid())
        )
    )
    with check (
        bucket_id = 'menu-item-photos'
        and exists (
            select 1 from public.staff_members
            where staff_members.user_id = (select auth.uid())
        )
    );
drop policy if exists "Staff can delete menu item photos" on storage.objects;
create policy "Staff can delete menu item photos"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'menu-item-photos'
        and exists (
            select 1 from public.staff_members
            where staff_members.user_id = (select auth.uid())
        )
    );

-- For the Customer Order database

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
