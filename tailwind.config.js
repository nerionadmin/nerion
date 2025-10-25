/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // ← activation du mode dark via classe CSS
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      height: {
        'logo-xs': '2.5rem',  // 40px
        'logo-sm': '3rem',    // 48px
        'logo-md': '3.5rem',  // 56px
        'logo-lg': '4rem',    // 64px
        'logo-xl': '5rem',    // 80px
        'logo-2xl': '6rem',   // 96px
      },
      // ✅ Ajout explicite des définitions de ping (au cas où)
      keyframes: {
        ping: {
          '75%, 100%': { transform: 'scale(2)', opacity: '0' },
        },
      },
      animation: {
        ping: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
};
