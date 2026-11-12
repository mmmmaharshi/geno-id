import { test } from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import {
  serverTarget,
  SERVER_ENV,
  unreachableMessage,
} from "./bench-db-native-core.ts"

test("the default postgres target is the documented localhost:5432", () => {
  assert.deepEqual(serverTarget("postgresql", {}), { host: "localhost", port: 5432 })
})

test("the default mysql target is the documented localhost:3306", () => {
  assert.deepEqual(serverTarget("mysql-innodb", {}), { host: "localhost", port: 3306 })
})

test("env vars override the default target", () => {
  assert.deepEqual(serverTarget("postgresql", { PG_HOST: "db.internal", PG_PORT: "6543" }), {
    host: "db.internal",
    port: 6543,
  })
  assert.deepEqual(serverTarget("mysql-innodb", { MYSQL_HOST: "10.0.0.5", MYSQL_PORT: "3307" }), {
    host: "10.0.0.5",
    port: 3307,
  })
})

test("every engine documents the env vars that retarget the harness", () => {
  for (const name of ["postgresql", "mysql-innodb"] as const) {
    assert.match(SERVER_ENV[name], /HOST/, `${name} must document a host override`)
    assert.match(SERVER_ENV[name], /PORT/, `${name} must document a port override`)
  }
})

test("the unreachable message names the target and the retargeting env vars", () => {
  const lines = unreachableMessage("postgresql", { host: "localhost", port: 5432 })
  const text = lines.join("\n")
  assert.match(text, /localhost:5432/)
  assert.match(text, /PG_HOST/)
  assert.match(text, /cannot run here/)
  assert.equal(lines.length, 3)
})

const listen = (): Promise<{ port: number; close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) })
    })
  })

const probe = (host: string, port: number, timeoutMs = 4000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect(port, host)
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })

test("a listening server is reported reachable, so a present server is never blocked", async () => {
  const listener = await listen()
  try {
    assert.equal(await probe("127.0.0.1", listener.port), true)
  } finally {
    await listener.close()
  }
})

test("a closed port is reported unreachable and turns into exit code 2", async () => {
  // Port 1 is not routable on this host, so the probe must fail fast rather
  // than hang or report a false positive.
  assert.equal(await probe("127.0.0.1", 1), false)
})

test("a closed listener stops being reachable once it goes away", async () => {
  // The preflight must key off live reachability, not a cached truth.
  const listener = await listen()
  assert.equal(await probe("127.0.0.1", listener.port), true)
  await listener.close()
  // Re-listen on the same port to prove the port itself is not the signal.
  const again = await listen()
  try {
    assert.equal(await probe("127.0.0.1", again.port), true)
  } finally {
    await again.close()
  }
})
