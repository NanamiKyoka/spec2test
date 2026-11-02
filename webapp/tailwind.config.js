/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./views/**/*.{ts,tsx}", "./ui/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        active: "rgb(var(--active) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        control: "rgb(var(--control) / <alpha-value>)",
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
        positive: "rgb(var(--positive) / <alpha-value>)",
        negative: "rgb(var(--negative) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      borderRadius: { sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)", sheet: "var(--r-sheet)" },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "-apple-system", "Segoe UI", "Microsoft YaHei", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace" /* taste-skill-ignore */, "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        overlay: "0 12px 40px rgb(0 0 0 / 0.18)",
      },
    },
  },
  plugins: [],
};
