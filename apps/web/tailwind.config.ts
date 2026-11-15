import type { Config } from 'tailwindcss';

// Design tokens. Names and values match the "TicketPay Tokens" variables in the Figma file.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { navy: '#0B1F3A', 'navy-700': '#14315C' },
        accent: { teal: '#0E9AA0', 'teal-soft': '#E1F5F5' },
        bg: { page: '#F5F7FA', surface: '#FFFFFF', muted: '#EDF1F6' },
        ink: { primary: '#0F172A', secondary: '#55627A', muted: '#8A94A6', inverse: '#FFFFFF', accent: '#0B7F85' },
        line: '#E2E8F0',
        status: {
          success: '#15803D', 'success-soft': '#DCFCE7',
          warning: '#B45309', 'warning-soft': '#FEF3C7',
          danger: '#B91C1C', 'danger-soft': '#FEE2E2',
          info: '#1D4ED8', 'info-soft': '#DBEAFE',
        },
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px' },
      boxShadow: { card: '0 4px 16px rgba(15, 23, 42, 0.08)' },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'] },
      fontSize: {
        display: ['48px', { lineHeight: '56px', fontWeight: '700' }],
        h1: ['36px', { lineHeight: '44px', fontWeight: '700' }],
        h2: ['28px', { lineHeight: '36px', fontWeight: '700' }],
        h3: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        title: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      maxWidth: { page: '1312px' },
    },
  },
  plugins: [],
};
export default config;
