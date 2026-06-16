import { Hono } from 'hono'
import type { Env } from './types'
import { api } from './api'
import { drainPendingEmbeddings } from './lib/embed'
import { pollRunningJobs } from './lib/pipeline'

const app = new Hono<{ Bindings: Env }>()

app.route('/api', api)

// Everything else -> the React SPA (served from web/dist via the ASSETS
// binding; not_found_handling="single-page-application" returns index.html).
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default {
  fetch: app.fetch,

  // Cron (free): advance the pipeline without Queues —
  //  1. check Apify runs whose webhook never arrived
  //  2. embed a few pending transcripts into Supabase pgvector
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await pollRunningJobs(env)
        await drainPendingEmbeddings(env, 3)
      })(),
    )
  },
}
