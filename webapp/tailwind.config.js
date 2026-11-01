/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./views/**/*.{ts,tsx}", "./ui/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        "accent-solid": "rgb(var(--accent-solid) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-ink": "rgb(var(--ok-ink) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-ink": "rgb(var(--warn-ink) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        "bad-ink": "rgb(var(--bad-ink) / <alpha-value>)",
      },
      borderRadius: { sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)" },
      fontFamily: {
        sans: ["Inter Variable", "system-ui", "-apple-system", "Segoe UI", "Microsoft YaHei", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06)" },
    },
  },
  plugins: [],
};
