/** @type {import('tailwindcss').Config} */
export default {
  // Tell Tailwind where to look for class names.
  // Any string found matching a Tailwind class in these files will be included
  // in the final CSS bundle — everything else gets tree-shaken out.
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
}

