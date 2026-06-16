import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Explore from './pages/Explore'
import Channels from './pages/Channels'
import Personas from './pages/Personas'
import Chat from './pages/Chat'
import Import from './pages/Import'
import SignIn from './pages/SignIn'
import AuthCallback from './pages/AuthCallback'
import { useAuth } from './lib/auth'
import { api } from './api'
import type { Persona } from './types'
import { channelColor, channelInitials } from './lib/persona'

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/personas" element={<Personas />} />
                <Route path="/chat/:channelId" element={<Chat />} />
                <Route path="/import" element={<Import />} />
              </Routes>
            </Shell>
          </RequireAuth>
        }
      />
    </Routes>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session, error } = useAuth()
  const loc = useLocation()
  if (!ready) return <Splash />
  if (error && !session) return <Splash error={error} />
  if (!session) return <Navigate to="/sign-in" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="text-center">
        <p className="font-display text-2xl font-normal tracking-tighter text-ink">
          YouTube <em className="italic text-accent">Personas</em>
        </p>
        <p className="mt-2 text-sm text-muted">{error ? error : 'Loading workspace…'}</p>
      </div>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-content px-6 py-7 sm:px-8">{children}</div>
      </main>
    </div>
  )
}

function Sidebar() {
  const { email, signOut } = useAuth()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  )

  useEffect(() => {
    api.get<Persona[]>('/api/personas').then(setPersonas).catch(() => setPersonas([]))
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    try {
      localStorage.setItem('yp-theme', next)
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-edge bg-surface px-3 py-5 md:flex">
      <Link
        to="/"
        className="mb-7 flex items-center gap-2.5 px-2.5 font-display text-[17px] font-medium tracking-tighter text-ink"
      >
        <BrandMark />
        <span>YT Personas</span>
      </Link>

      <nav aria-label="Main navigation" className="mb-6 flex flex-col gap-0.5">
        <div className="eyebrow mb-1.5 px-2.5">Workspace</div>
        <SidebarLink to="/" end label="Dashboard" glyph="◆" />
        <SidebarLink to="/explore" label="Explore" glyph="◇" />
        <SidebarLink to="/channels" label="Channels" glyph="▤" />
        <SidebarLink to="/personas" label="Personas" glyph="☺" />
        <SidebarLink to="/import" label="Import" glyph="↑" />
      </nav>

      {personas.length > 0 && (
        <div className="mb-6 flex flex-col gap-0.5">
          <div className="eyebrow mb-1.5 px-2.5">Recent personas</div>
          {personas.slice(0, 5).map((p) => (
            <NavLink
              key={p.channel_id}
              to={`/chat/${p.channel_id}`}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <PersonaDot id={p.channel_id} label={p.persona_name} />
              <span className="truncate">{p.persona_name}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <button onClick={toggleTheme} className="nav-link justify-between" type="button" aria-label="Toggle color theme">
          <span className="flex items-center gap-2.5">
            <span aria-hidden>{theme === 'dark' ? '◑' : '◐'}</span>
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </span>
        </button>
        <div className="mt-2 flex items-center gap-2.5 border-t border-edge px-2.5 pt-3.5">
          <UserAvatar email={email} />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="truncate font-semibold text-ink">{email?.split('@')[0] ?? 'Signed in'}</div>
            <div className="truncate font-mono text-[11px] text-muted">{email ?? ''}</div>
          </div>
          <button
            onClick={() => signOut()}
            className="rounded-sm border border-edge px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-edge-strong hover:text-ink"
            type="button"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
        <VersionBadge />
      </div>
    </aside>
  )
}

// Shows the exact build the running app was compiled from. On the deployed app
// this is the source of truth for "did my latest commit reach production?" —
// compare the SHA here to the latest committed SHA. See CLAUDE.md.
function VersionBadge() {
  return (
    <div
      className="mt-1 px-2.5 font-mono text-[10px] text-muted"
      title={`Built ${__BUILD_TIME__} · commit ${__APP_SHA__}`}
    >
      <span className="text-muted/70">version </span>
      <span className="text-ink-2">{__APP_VERSION__}</span>
    </div>
  )
}

function SidebarLink({ to, label, glyph, end }: { to: string; label: string; glyph: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <span aria-hidden className="w-4 text-center text-[14px] leading-none">
        {glyph}
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

function BrandMark() {
  return (
    <div
      className="grid h-6 w-6 place-items-center rounded-sm font-sans text-[11px] font-bold text-white"
      style={{ background: 'linear-gradient(135deg, var(--accent), #E07B6E)' }}
    >
      YP
    </div>
  )
}

function PersonaDot({ id, label }: { id: string; label: string }) {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-semibold text-white"
      style={{ background: channelColor(id) }}
    >
      {channelInitials(label, id).slice(0, 2)}
    </span>
  )
}

function UserAvatar({ email }: { email: string | null }) {
  const initials =
    (email?.split('@')[0] || '?')
      .split(/[._-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?'
  return (
    <div
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: 'var(--accent)' }}
    >
      {initials}
    </div>
  )
}
