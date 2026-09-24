/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f4f2ff",
          100: "#ebe7ff",
          200: "#d9d3ff",
          300: "#beb2ff",
          400: "#9c83ff",
          500: "#7c53fb",
          600: "#6a35f0",
          700: "#5a24d4",
          800: "#4b1fb0",
          900: "#3e1a8e",
        },
        ink: {
          900: "#0b0817",
          850: "#120e22",
          800: "#171229",
          700: "#221b3c",
          600: "#2e2450",
          400: "#8b83a8",
          300: "#b3aecd",
          200: "#d5d1e6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};