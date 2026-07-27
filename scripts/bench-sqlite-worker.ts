import { parentPort } from "node:worker_threads"
import { benchCompositeKeyArm } from "./bench-sqlite.ts"
import type { CompositeKeyArm } from "./bench-sqlite.ts"

parentPort!.on("message", (msg: { arm: CompositeKeyArm; n: number; trialIndex: number; ids: unknown[]; totalTrials: number; lookupCount: number }) => {
  const result = benchCompositeKeyArm(msg.arm, msg.n, msg.ids, msg.lookupCount, msg.trialIndex, msg.totalTrials)
  // eslint-disable-next-line unicorn/require-post-message-target-origin
  parentPort!.postMessage({ trialIndex: msg.trialIndex, result })
})
