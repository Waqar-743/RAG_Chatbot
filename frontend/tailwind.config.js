/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ethereal Glass palette — OLED black + cool accents
        ink: {
          DEFAULT: '#050505',
          950: '#080808',
          900: '#0a0a0c',
          800: '#101014',
          700: '#16161c',
          600: '#1d1d24',
        },
        accent: {
          DEFAULT: '#C9B8FF',  // soft lavender — the signal color
          glow: '#9D7CFF',
          deep: '#5B3DBF',
          mint: '#A7F3D0',
        },
        chalk: {
          DEFAULT: '#FAFAFA',
          dim: '#B8B8C0',
          mute: '#6E6E78',
          ghost: '#3A3A42',
        },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        display: ['"Instrument Serif"', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        'tightest': '-0.04em',
        'editorial': '-0.06em',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.32,0.72,0,1)',
        'silk': 'cubic-bezier(0.16,1,0.3,1)',
        'mass': 'cubic-bezier(0.6,0.05,0.1,1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)', filter: 'blur(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'orb-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(40px,-30px,0) scale(1.1)' },
        },
        'breathe': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
      animation: {
        'fade-up': 'fade-up 800ms cubic-bezier(0.16,1,0.3,1) both',
        'shimmer': 'shimmer 3s linear infinite',
        'orb-drift': 'orb-drift 18s cubic-bezier(0.45,0.05,0.55,0.95) infinite',
        'breathe': 'breathe 4s cubic-bezier(0.45,0.05,0.55,0.95) infinite',
      },
    },
  },
  plugins: [],
}
