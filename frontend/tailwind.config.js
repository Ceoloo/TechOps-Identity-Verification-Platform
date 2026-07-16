/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 500: '#1f6feb', 600: '#1a5fd0', 700: '#164fac',
        },
      },
    },
  },
  plugins: [],
};
