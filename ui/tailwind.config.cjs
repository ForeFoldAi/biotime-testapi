/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "0.75rem",
        md: "calc(0.75rem - 2px)",
        sm: "calc(0.75rem - 4px)",
      },
      colors: {
        background: "#FFFFFF",
        foreground: "hsl(222 47% 11%)",
        card: "hsl(0 0% 100%)",
        "card-foreground": "hsl(222 47% 11%)",
        muted: "hsl(210 40% 96%)",
        "muted-foreground": "hsl(215 16% 36%)",
        primary: "#2563EB",
        "primary-foreground": "hsl(0 0% 100%)",
        secondary: "#64748B",
        "secondary-foreground": "hsl(0 0% 100%)",
        border: "hsl(214 32% 91%)",
        input: "hsl(214 32% 96%)",
        ring: "#2563EB",
        destructive: "hsl(0 72% 51%)",
        "destructive-foreground": "hsl(210 40% 98%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(37, 99, 235, 0.2), 0 14px 34px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};
