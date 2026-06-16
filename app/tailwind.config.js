/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        edge: 'var(--border)',
        'edge-strong': 'var(--border-strong)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        'muted-2': 'var(--muted-2)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        success: 'var(--success)',
        'success-soft': 'var(--success-soft)',
        warning: 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
        error: 'var(--error)',
        'error-soft': 'var(--error-soft)',
        info: 'var(--info)',
        'info-soft': 'var(--info-soft)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Inter Tight"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(26,24,22,.04), 0 1px 3px rgba(26,24,22,.04)',
        md: '0 2px 4px rgba(26,24,22,.04), 0 4px 12px rgba(26,24,22,.06)',
        'dark-sm': '0 1px 2px rgba(0,0,0,.3)',
        'dark-md': '0 2px 4px rgba(0,0,0,.3), 0 4px 12px rgba(0,0,0,.4)',
      },
      letterSpacing: {
        tightest: '-0.03em',
        tighter: '-0.02em',
        eyebrow: '0.12em',
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
}
