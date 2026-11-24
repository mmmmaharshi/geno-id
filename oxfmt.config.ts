import { defineConfig } from "oxfmt"
import ultracite from "ultracite/oxfmt"

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "results/**",
    "sources/**",
    "docs/**",
    "golden/**",
    "**/*.md",
    "paper.tex",
  ],
  semi: false,
})
