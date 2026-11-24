-- CSE WALE: run this once in Supabase -> SQL Editor -> New query -> Run.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, email text, mobile text,
  created_at timestamptz not null default now()
);
create table if not exists tests (
  id text primary key,                 -- e.g. 'mock-1'
  title text not null,
  subtitle text default '',
  duration_min int not null default 120,
  positive int not null default 3,
  negative int not null default 1,
  question_count int not null default 0,
  opens_at timestamptz,                -- null = open immediately
  closes_at timestamptz,               -- null = never closes
  published boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists questions (
  id bigserial primary key,
  test_id text not null references tests(id) on delete cascade,
  n int not null,
  subject text not null,
  difficulty text default '',
  q text not null,
  code text default '',
  options jsonb not null,
  answer int not null check (answer between 0 and 3),
  solution text default '',
  takeaway text default '',
  unique (test_id, n)
);
create table if not exists purchases (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  amount int not null,                 -- in paise
  status text not null default 'created',   -- created | paid
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists purchases_user on purchases(user_id, status);
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id text not null references tests(id) on delete cascade,
  started_at timestamptz not null default now(),
  duration_sec int not null,
  submitted_at timestamptz,
  state jsonb,
  score int, correct int, wrong int, unattempted int, time_spent int,
  late boolean not null default false,
  unique (user_id, test_id)
);
create index if not exists attempts_rank on attempts(test_id, score, time_spent) where submitted_at is not null;

-- Lock every table. The website talks to the database only through the server (service key),
-- so nobody can read questions, answers or other students' data with the public key.
alter table profiles  enable row level security;
alter table tests     enable row level security;
alter table questions enable row level security;
alter table purchases enable row level security;
alter table attempts  enable row level security;
