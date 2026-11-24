import { parentPort } from "node:worker_threads"

import { need } from "../shared/need.ts"
import { benchCompositeKeyArm } from "./bench-sqlite.ts"

type CompositeKeyArm = Parameters<typeof benchCompositeKeyArm>[0]

need(parentPort).on(
  "message",
  (msg: {
    arm: CompositeKeyArm
    n: number
    trialIndex: number
    ids: unknown[]
    totalTrials: number
    lookupCount: number
  }) => {
    const result = benchCompositeKeyArm(
      msg.arm,
      msg.n,
      msg.ids,
      msg.lookupCount,
      msg.trialIndex,
      msg.totalTrials
    )

    need(parentPort).postMessage({ result, trialIndex: msg.trialIndex }, [])
  }
)
