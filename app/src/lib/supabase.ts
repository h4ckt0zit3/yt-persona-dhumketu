import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../types'

// One client per request is fine on Workers (it's just a fetch wrapper).
// The worker MUST use the service_role key — it bypasses RLS and has grants on
// the base tables. If the key is missing or is actually the anon key (a common
// `wrangler secret put` mistake), every base-table query fails with the cryptic
// "permission denied for table X" / silent "not found". Fail loud instead.
export function getDb(env: Env): SupabaseClient {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. In production run: wrangler secret put SUPABASE_SERVICE_ROLE_KEY ' +
        '(value from Supabase → Settings → API → service_role "secret"), then redeploy.',
    )
  }
  if (key === env.SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is set to the ANON key — the worker needs the service_role key (it must bypass ' +
        'RLS). Re-run: wrangler secret put SUPABASE_SERVICE_ROLE_KEY with the service_role "secret" from Supabase → ' +
        'Settings → API, then redeploy.',
    )
  }
  return createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// pgvector columns/args must be sent as the text form "[1,2,3]", not a JS array.
export function vecLiteral(values: number[]): string {
  return JSON.stringify(values)
}
