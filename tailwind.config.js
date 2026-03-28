/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/src/**/*.{html,js,ts,jsx,tsx}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        kawaii: {
          bg:         '#0F0F1A',
          surface:    '#1A1B2E',
          'surface-2':'#252641',
          'surface-3':'#2E2F52',
          pink:       '#FF6B9D',
          'pink-l':   '#FF8FB1',
          purple:     '#B57BFF',
          'purple-l': '#C89BFF',
          teal:       '#4ECDC4',
          text:       '#F8F0FF',
          muted:      '#9A8FBE',
          dim:        '#6B6090',
          error:      '#FF6B6B',
          success:    '#4CAF82',
        }
      },
      fontFamily: {
        kawaii: ['Nunito', 'system-ui', 'sans-serif'],
      },
      animation: {
        'bounce-dot': 'bounce-dot 1.4s ease-in-out infinite',
        'fade-in':    'fade-in 0.2s ease-out',
        'slide-up':   'slide-up 0.25s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'scale(0)', opacity: '0.3' },
          '40%':           { transform: 'scale(1)', opacity: '1'   },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'   },
        },
      }
    }
  },
  plugins: []
}
