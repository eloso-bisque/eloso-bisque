import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bisque: {
          50: "#fdf8f0",
          100: "#faefd8",
          200: "#f5ddb0",
          300: "#eec67e",
          400: "#e8aa4a",
          500: "#e29428",
          600: "#d47d1e",
          700: "#b0621a",
          800: "#8d4e1c",
          900: "#72411a",
          950: "#3d200a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
