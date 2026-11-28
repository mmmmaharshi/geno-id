import { readFileSync } from "node:fs"
import path from "node:path"

const __dirname = import.meta.dirname

const paperPath = path.resolve(__dirname, "..", "..", "paper", "paper.tex")

export interface PaperViolation {
  line: number

  rule: string

  text: string
}

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "triple-dash", pattern: /---/u },

  { name: "unicode-em-dash", pattern: /—/u },

  { name: "unicode-en-dash", pattern: /–/u },
]

export const lintPaperText = (text: string): PaperViolation[] => {
  const hits: PaperViolation[] = []

  for (const [i, raw] of text.split("\n").entries()) {
    for (const rule of RULES) {
      if (rule.pattern.test(raw)) {
        hits.push({ line: i + 1, rule: rule.name, text: raw.trim() })
      }
    }
  }

  return hits
}

if (import.meta.main) {
  const source = readFileSync(paperPath, "utf8")

  const hits = lintPaperText(source)

  if (hits.length > 0) {
    for (const h of hits) {
      console.error(`${h.line}: ${h.rule}: ${h.text}`)
    }

    process.exitCode = 1
  } else {
    console.log("paper.tex clean")
  }
}
