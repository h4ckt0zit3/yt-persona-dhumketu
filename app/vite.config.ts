import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// The deployed app shows its version in the sidebar footer. The VISIBLE badge is
// just the semver x.x.x from package.json — bump it when you cut a release you
// want to verify reached production. The git SHA + build time are baked in too
// but only shown on hover (tooltip), for debugging. See CLAUDE.md
// "Versioning & deploy verification".
function buildVersion() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  let sha = 'dev'
  try {
    sha = execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    /* not a git checkout (e.g. CI tarball) — fall back to "dev" */
  }
  return {
    full: pkg.version, // x.x.x only
    sha,
    builtAt: new Date().toISOString(),
  }
}

const v = buildVersion()

// The React app lives in ./web and builds to ./web/dist, which wrangler
// serves as static assets. During `npm run dev`, /api is proxied to the
// local Worker (`npm run dev:worker`, port 8787).
export default defineConfig({
  plugins: [react()],
  root: 'web',
  define: {
    __APP_VERSION__: JSON.stringify(v.full),
    __APP_SHA__: JSON.stringify(v.sha),
    __BUILD_TIME__: JSON.stringify(v.builtAt),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
