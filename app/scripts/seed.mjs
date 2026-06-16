#!/usr/bin/env node
// Seed the deployed app from an existing CSV file.
// Usage:
//   node scripts/seed.mjs <baseUrl> <channels|niches> <csvPath>
// Examples:
//   node scripts/seed.mjs http://localhost:8787 niches   ../01-niches-database/niches-master.csv
//   node scripts/seed.mjs http://localhost:8787 channels ../02-channels-database/channels-master.csv
//
// Auth: /api/import/* is behind the workspace auth gate, so against a DEPLOYED
// app this script must send a bearer token (only a local `wrangler dev` with
// DEV_AUTH=true skips it). Credentials, in priority order:
//   1. AUTOMATION_TOKEN — a raw Supabase access_token (env)
//   2. AUTOMATION_EMAIL + AUTOMATION_PASSWORD (env or app/.dev.vars) — password grant
// The email MUST be in ALLOWED_EMAILS (wrangler.toml). First time:
//   node scripts/create-user.mjs automation@dhumketu.space "<password>"
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fromFile(file, key) {
  try {
    const txt = readFileSync(resolve(appRoot, file), 'utf8')
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+)`, 'm'))
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

const [baseUrl, kind, csvPath] = process.argv.slice(2)
if (!baseUrl || !kind || !csvPath) {
  console.error('Usage: node scripts/seed.mjs <baseUrl> <channels|niches> <csvPath>')
  process.exit(1)
}
if (kind !== 'channels' && kind !== 'niches') {
  console.error('kind must be "channels" or "niches"')
  process.exit(1)
}

// Obtain a bearer token the /api auth gate accepts. Returns null only for a
// local dev server where DEV_AUTH bypasses auth and no creds are configured.
async function getToken() {
  const raw = process.env.AUTOMATION_TOKEN
  if (raw) return raw

  const email = process.env.AUTOMATION_EMAIL || fromFile('.dev.vars', 'AUTOMATION_EMAIL')
  const password = process.env.AUTOMATION_PASSWORD || fromFile('.dev.vars', 'AUTOMATION_PASSWORD')
  if (!email || !password) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)
    if (local) return null // local `wrangler dev` with DEV_AUTH=true needs no token
    console.error(
      '✗ No credentials, but the import endpoints require auth on a deployed app.\n' +
        '  Set AUTOMATION_TOKEN, or AUTOMATION_EMAIL + AUTOMATION_PASSWORD (env or app/.dev.vars).\n' +
        '  First time: node scripts/create-user.mjs automation@dhumketu.space "<password>"',
    )
    process.exit(1)
  }

  const supabaseUrl = process.env.SUPABASE_URL || fromFile('wrangler.toml', 'SUPABASE_URL')
  const anonKey = process.env.SUPABASE_ANON_KEY || fromFile('wrangler.toml', 'SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    console.error('✗ Missing SUPABASE_URL / SUPABASE_ANON_KEY (wrangler.toml).')
    process.exit(1)
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    console.error(`✗ Supabase sign-in failed (${res.status}) for ${email}.`, JSON.stringify(body))
    process.exit(1)
  }
  return body.access_token
}

const token = await getToken()
const csv = await readFile(csvPath, 'utf8')
const res = await fetch(`${baseUrl}/api/import/${kind}`, {
  method: 'POST',
  headers: {
    'content-type': 'text/csv',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: csv,
})
const text = await res.text()
if (!res.ok) {
  console.error(`Failed (${res.status}): ${text}`)
  process.exit(1)
}
console.log(`OK: ${text}`)
