-- Run once in Supabase -> SQL Editor (existing database). Safe to run again.
alter table tests add column if not exists is_free boolean not null default false;
-- Make Mock Test 1 the free demo:
update tests set is_free = true where id = 'mock-1';