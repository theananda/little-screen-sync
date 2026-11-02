import pg from "pg";

// Keep DATE columns as plain 'YYYY-MM-DD' strings; JS Date objects shift them by the server's time zone.
pg.types.setTypeParser(1082, v => v);

const ssl =process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

const SCHEMA = `
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  pass_hash text not null,
  rules jsonb not null default '{}'::jsonb,
  rules_version integer not null default 1,
  pin jsonb,
  tz text not null default 'UTC',
  tg_chat_id text,
  tg_link_code text unique,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  family_id uuid not null references families(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  token_hash text unique not null,
  last_seen timestamptz,
  usage_date date,
  usage_sec integer not null default 0,
  extra_min integer not null default 0,
  pin_fails integer not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists pair_codes (
  code text primary key,
  family_id uuid not null references families(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists requests (
  id serial primary key,
  family_id uuid not null references families(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  video jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists requests_family_status on requests(family_id, status);
create table if not exists channel_cache (
  channel_id text primary key,
  info jsonb,
  items jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
create table if not exists video_cache (
  video_id text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
`;

export async function migrate() { await pool.query(SCHEMA); }

// YouTube API data may be kept at most 30 days; expired pairing codes are dropped too.
export async function purge() {
  await q("delete from channel_cache where fetched_at < now() - interval '30 days'");
  await q("delete from video_cache where fetched_at < now() - interval '30 days'");
  await q("delete from pair_codes where expires_at < now()");
  await q("delete from sessions where created_at < now() - interval '60 days'");
}
