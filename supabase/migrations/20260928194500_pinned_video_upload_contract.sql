-- Staged input contract for the private pinned Kaggle specialist pilot.
-- This migration does not activate a runner, publish media, or send SMS.
alter table public.rg_surveys
  drop constraint if exists rg_surveys_inference_provider_check;
alter table public.rg_surveys
  add constraint rg_surveys_inference_provider_check
  check (inference_provider in ('kaggle', 'aws', 'kaggle_yolo26'));

alter table public.rg_processing_jobs
  drop constraint if exists rg_processing_jobs_provider_check;
alter table public.rg_processing_jobs
  add constraint rg_processing_jobs_provider_check
  check (provider in ('kaggle', 'aws', 'kaggle_yolo26'));

alter table public.rg_assets
  add column if not exists clip_start_seconds numeric,
  add column if not exists clip_duration_seconds numeric,
  add column if not exists clip_target_fps integer,
  add column if not exists linked_photo_asset_id uuid references public.rg_assets(id);

alter table public.rg_assets
  add constraint rg_assets_clip_selection_check check (
    (clip_start_seconds is null and clip_duration_seconds is null and
     clip_target_fps is null and linked_photo_asset_id is null)
    or
    (mime = 'video/mp4' and clip_start_seconds >= 0 and
     clip_duration_seconds > 0 and clip_duration_seconds <= 30 and
     clip_target_fps = 30 and linked_photo_asset_id is not null and
     duration_seconds is not null and
     clip_start_seconds + clip_duration_seconds <= duration_seconds + 0.01)
  );

create index if not exists rg_assets_linked_photo
  on public.rg_assets(linked_photo_asset_id)
  where linked_photo_asset_id is not null;
