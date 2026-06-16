// Creates (or updates) a shared email+password user in Supabase so you can log
// in with a fixed credential — no magic-link emails, works locally and on the
// deployed app.
//
//   node scripts/create-user.mjs team@personas.local "a-strong-password"
//
// Reads SUPABASE_URL from wrangler.toml [vars] and SUPABASE_SERVICE_ROLE_KEY
// from .dev.vars (or the env). After creating the user, add its email to
// ALLOWED_EMAILS in wrangler.toml so the auth gate lets it through.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

function fromFile(file, key) {
  try {
    const txt = readFileSync(resolve(appRoot, file), 'utf8')
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+)`, 'm'))
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <password>')
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL || fromFile('wrangler.toml', 'SUPABASE_URL')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile('.dev.vars', 'SUPABASE_SERVICE_ROLE_KEY')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL (wrangler.toml) or SUPABASE_SERVICE_ROLE_KEY (.dev.vars).')
  process.exit(1)
}

const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
})

const body = await res.json().catch(() => ({}))
if (res.ok) {
  console.log(`✓ Created user ${email}`)
} else if (res.status === 422 || /already.*registered|exists/i.test(JSON.stringify(body))) {
  // User exists — reset the password via admin update so the credential is known.
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  }).then((r) => r.json())
  const existing = (list.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!existing) {
    console.error('User exists but could not be located to reset password:', body)
    process.exit(1)
  }
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
    method: 'PUT',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ password, email_confirm: true }),
  })
  if (!upd.ok) {
    console.error('Failed to update existing user:', await upd.text())
    process.exit(1)
  }
  console.log(`✓ Updated password for existing user ${email}`)
} else {
  console.error(`Failed (${res.status}):`, body)
  process.exit(1)
}

console.log('\nNext: ensure this email is in ALLOWED_EMAILS in wrangler.toml, then sign in with email + password.')
