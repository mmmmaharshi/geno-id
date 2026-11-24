import config from "./oxlint.rules.json" with { type: "json" }
import { defineConfig } from "oxlint"

export default defineConfig(config)
