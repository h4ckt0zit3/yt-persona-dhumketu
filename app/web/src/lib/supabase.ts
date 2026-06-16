import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface BootstrapConfig {
  supabase_url: string
  supabase_anon_key: string
  dev_auth: boolean
  dev_email: string | null
  embed_provider?: string
}

let configPromise: Promise<BootstrapConfig> | null = null

// Public /api/config — cached so auth + the Supabase client share one fetch.
export function getBootstrap(): Promise<BootstrapConfig> {
  if (configPromise) return configPromise
  configPromise = (async () => {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`Failed to load app config (${res.status})`)
    return (await res.json()) as BootstrapConfig
  })()
  return configPromise
}

let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise
  clientPromise = (async () => {
    const cfg = await getBootstrap()
    if (!cfg.supabase_url || !cfg.supabase_anon_key) {
      throw new Error('App config is missing Supabase credentials')
    }
    return createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  })()
  return clientPromise
}
