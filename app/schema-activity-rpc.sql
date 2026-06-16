-- get_activity(): one round-trip backing /api/activity (the LiveMonitor polls
-- it every ~5s). Replaces ~5 separate PostgREST queries with a single function
-- call so Postgres does the counting/aggregation in-process — much lighter on
-- the free tier. The worker (src/api.ts /activity) calls db.rpc('get_activity')
-- and FALLS BACK to the multi-query path if this function is absent, so applying
-- this migration is an optimization, never a hard requirement.
--
-- Apply by pasting into the Supabase SQL editor. Re-runnable (CREATE OR REPLACE).
-- The returned shape MUST match what web/src/components/LiveMonitor.tsx expects.

create or replace function get_activity()
returns json
language sql
stable
as $$
  select json_build_object(
    'running_jobs', coalesce((
      select json_agg(j) from (
        select id, job_type, status, channel_id, started_at, input_params
        from pipeline_jobs
        where status = 'running' and job_type not like 'cron_%'
        order by started_at desc
        limit 50
      ) j
    ), '[]'::json),

    'stages', json_build_object(
      'transcribing', json_build_object(
        'count', (select count(*) from videos where transcript_status = 'processing'),
        'by_channel', coalesce((
          select json_object_agg(channel_id, c) from (
            select channel_id, count(*) as c from videos
            where transcript_status = 'processing' and channel_id is not null
            group by channel_id
          ) t
        ), '{}'::json)
      ),
      'embedding', json_build_object(
        'count', (select count(*) from transcripts where embedding_status = 'processing'),
        'by_channel', coalesce((
          select json_object_agg(channel_id, c) from (
            select channel_id, count(*) as c from transcripts
            where embedding_status = 'processing' and channel_id is not null
            group by channel_id
          ) t
        ), '{}'::json)
      )
    ),

    'queues', json_build_object(
      'transcripts_pending', (select count(*) from transcripts where embedding_status = 'pending'),
      'transcripts_failed',  (select count(*) from transcripts where embedding_status = 'failed'),
      'videos_pending',      (select count(*) from videos where transcript_status = 'pending')
    ),

    'cron', json_build_object(
      'embed_drain', (
        select to_jsonb(t) from (
          select status, completed_at, output_stats, error_message
          from pipeline_jobs where job_type = 'cron_embed_drain'
          order by created_at desc limit 1
        ) t
      ),
      'apify_poll', (
        select to_jsonb(t) from (
          select status, completed_at, output_stats, error_message
          from pipeline_jobs where job_type = 'cron_apify_poll'
          order by created_at desc limit 1
        ) t
      )
    )
  );
$$;

grant execute on function get_activity() to service_role, authenticated, anon;

-- Refresh PostgREST's schema cache so the new function is callable immediately.
notify pgrst, 'reload schema';
