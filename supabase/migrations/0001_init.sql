-- MomentScout core schema (Phase 3+: auth, projects, uploads, transcripts, export jobs)
-- Not yet applied to a live Supabase project in this build - see README "What's implemented vs deferred".
-- Written against Supabase Postgres conventions: https://supabase.com/docs/guides/database

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cached metadata for a discovered public source (e.g. a YouTube video). Refreshed
-- periodically per the provider's caching rules; not the system of record for provider data.
create table saved_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  provider text not null,
  provider_id text not null,
  url text not null,
  title text not null,
  channel_title text,
  channel_url text,
  thumbnail_url text,
  duration_seconds integer,
  view_count bigint,
  stats_fetched_at timestamptz,
  can_preview boolean not null default false,
  can_analyze boolean not null default false,
  can_export boolean not null default false,
  capability_reason text,
  evidence_type text not null default 'metadata' check (evidence_type in ('metadata', 'transcript', 'video')),
  created_at timestamptz not null default now(),
  unique (project_id, provider, provider_id)
);

create table bookmarks (
  id uuid primary key default gen_random_uuid(),
  saved_source_id uuid not null references saved_sources (id) on delete cascade,
  start_seconds integer,
  end_seconds integer,
  note text not null default '',
  link_type text not null check (link_type in ('timestamp', 'official_clip')),
  saved_link text not null,
  created_at timestamptz not null default now()
);

-- Authorized media the user has rights to (uploads or licensed/partner footage).
create table media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  saved_source_id uuid references saved_sources (id) on delete set null,
  owner_id uuid not null references profiles (id) on delete cascade,
  storage_key text not null,
  original_filename text,
  duration_seconds numeric,
  width integer,
  height integer,
  rights_basis text,
  rights_evidence_url text,
  source_offset_seconds numeric not null default 0,
  created_at timestamptz not null default now()
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets (id) on delete cascade,
  language text,
  created_at timestamptz not null default now()
);

create table transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  text text not null,
  embedding vector(1536),
  check (start_seconds < end_seconds)
);
create index transcript_segments_embedding_idx on transcript_segments using ivfflat (embedding vector_cosine_ops);

create table suggested_moments (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  topic text not null,
  evidence_excerpt text not null,
  rationale text not null,
  evidence_source text not null,
  created_at timestamptz not null default now(),
  check (start_seconds < end_seconds)
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets (id) on delete cascade,
  owner_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('export', 'transcribe', 'scene_index')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress numeric,
  params jsonb not null default '{}'::jsonb,
  output_key text,
  error text,
  retry_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table projects enable row level security;
alter table saved_sources enable row level security;
alter table bookmarks enable row level security;
alter table media_assets enable row level security;
alter table transcripts enable row level security;
alter table transcript_segments enable row level security;
alter table suggested_moments enable row level security;
alter table processing_jobs enable row level security;

create policy "profiles are self-readable" on profiles for select using (auth.uid() = id);
create policy "profiles are self-writable" on profiles for update using (auth.uid() = id);

create policy "projects are owner-scoped" on projects for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "saved_sources follow project ownership" on saved_sources for all
  using (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "bookmarks follow source ownership" on bookmarks for all
  using (exists (
    select 1 from saved_sources s join projects p on p.id = s.project_id
    where s.id = saved_source_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from saved_sources s join projects p on p.id = s.project_id
    where s.id = saved_source_id and p.owner_id = auth.uid()
  ));

create policy "media_assets are owner-scoped" on media_assets for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "transcripts follow asset ownership" on transcripts for all
  using (exists (select 1 from media_assets m where m.id = media_asset_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from media_assets m where m.id = media_asset_id and m.owner_id = auth.uid()));

create policy "transcript_segments follow transcript ownership" on transcript_segments for all
  using (exists (
    select 1 from transcripts t join media_assets m on m.id = t.media_asset_id
    where t.id = transcript_id and m.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from transcripts t join media_assets m on m.id = t.media_asset_id
    where t.id = transcript_id and m.owner_id = auth.uid()
  ));

create policy "suggested_moments follow asset ownership" on suggested_moments for all
  using (exists (select 1 from media_assets m where m.id = media_asset_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from media_assets m where m.id = media_asset_id and m.owner_id = auth.uid()));

create policy "processing_jobs are owner-scoped" on processing_jobs for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
