// Per-persona derived visual identity. Each channel_id maps deterministically
// to one of the curated palette colors so every creator gets their own face.
// Palette mirrors the swatches in DESIGN.md.

const PALETTE = [
  '#3D6B8F', // blue
  '#3F7A4D', // green
  '#C77F1C', // amber
  '#8B5A9F', // violet
  '#A93838', // brick
  '#6B6660', // slate
] as const

export function channelColor(channelId: string | null | undefined): string {
  if (!channelId) return PALETTE[0]
  let h = 0
  for (let i = 0; i < channelId.length; i++) {
    h = (h * 31 + channelId.charCodeAt(i)) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

export function channelInitials(name: string | null | undefined, id?: string): string {
  const source = (name || id || '??').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts.length === 1) {
    const p = parts[0]
    return (p.slice(0, 2) || '??').toUpperCase()
  }
  return '??'
}
