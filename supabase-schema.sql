create table if not exists public.task_categories (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (owner_id, name)
);

create table if not exists public.tasks (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  details text not null default '' check (char_length(details) <= 500),
  category text not null default '',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  completed boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists tasks_owner_created_at_idx
  on public.tasks (owner_id, created_at desc);

alter table public.task_categories enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Users can read their task categories" on public.task_categories;
create policy "Users can read their task categories"
  on public.task_categories for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their task categories" on public.task_categories;
create policy "Users can create their task categories"
  on public.task_categories for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their task categories" on public.task_categories;
create policy "Users can delete their task categories"
  on public.task_categories for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can read their tasks" on public.tasks;
create policy "Users can read their tasks"
  on public.tasks for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their tasks" on public.tasks;
create policy "Users can create their tasks"
  on public.tasks for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their tasks" on public.tasks;
create policy "Users can update their tasks"
  on public.tasks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their tasks" on public.tasks;
create policy "Users can delete their tasks"
  on public.tasks for delete to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, delete on public.task_categories to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
