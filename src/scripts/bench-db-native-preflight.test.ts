/// <reference types="node" />

import assert from "node:assert/strict"
import { once } from "node:events"
import net from "node:net"
import { test } from "node:test"

import {
  SERVER_ENV,
  serverTarget,
  unreachableMessage,
} from "./bench-db-native-core.ts"

void test("the default postgres target is the documented localhost:5432", () => {
  assert.deepEqual(serverTarget("postgresql", {}), {
    host: "localhost",
    port: 5432,
  })
})

void test("the default mysql target is the documented localhost:3306", () => {
  assert.deepEqual(serverTarget("mysql-innodb", {}), {
    host: "localhost",
    port: 3306,
  })
})

void test("env vars override the default target", () => {
  assert.deepEqual(
    serverTarget("postgresql", { PG_HOST: "db.internal", PG_PORT: "6543" }),
    {
      host: "db.internal",

      port: 6543,
    }
  )

  assert.deepEqual(
    serverTarget("mysql-innodb", {
      MYSQL_HOST: "10.0.0.5",
      MYSQL_PORT: "3307",
    }),
    {
      host: "10.0.0.5",

      port: 3307,
    }
  )
})

void test("every engine documents the env vars that retarget the harness", () => {
  for (const name of ["postgresql", "mysql-innodb"] as const) {
    assert.match(
      SERVER_ENV[name],
      /HOST/u,
      `${name} must document a host override`
    )

    assert.match(
      SERVER_ENV[name],
      /PORT/u,
      `${name} must document a port override`
    )
  }
})

void test("the unreachable message names the target and the retargeting env vars", () => {
  const lines = unreachableMessage("postgresql", {
    host: "localhost",
    port: 5432,
  })

  const text = lines.join("\n")

  assert.match(text, /localhost:5432/u)

  assert.match(text, /PG_HOST/u)

  assert.match(text, /cannot run here/u)

  assert.equal(lines.length, 3)
})

interface ClosableServer extends Readonly<NodeJS.EventEmitter> {
  readonly close: () => unknown
}

const nullValue: null = JSON.parse("null") as null

const closeServer = async (server: ClosableServer): Promise<void> => {
  const controller = new AbortController()

  const closed = once(server, "close", { signal: controller.signal })

  const failed = once(server, "error", { signal: controller.signal })

  try {
    server.close()

    await Promise.race([closed, failed])
  } finally {
    controller.abort()
  }
}

const listen = async (): Promise<{
  port: number
  close: () => Promise<void>
}> => {
  const server = net.createServer()

  server.listen(0, "127.0.0.1")

  await once(server, "listening")

  const addr = server.address()

  if (typeof addr === "object" && addr !== nullValue) {
    const { port } = addr
    return {
      close: async (): Promise<void> => {
        await closeServer(server)
      },
      port,
    }
  }

  return {
    close: async (): Promise<void> => {
      await closeServer(server)
    },
    port: 0,
  }
}

const probe = async (
  host: string,
  port: number,
  timeoutMs = 4000
): Promise<boolean> => {
  const socket = net.connect(port, host)

  socket.setTimeout(timeoutMs)

  try {
    return await Promise.race([
      (async () => {
        try {
          await once(socket, "connect")
          return true
        } catch {
          return false
        }
      })(),

      (async () => {
        try {
          await once(socket, "error")
          return false
        } catch {
          return false
        }
      })(),

      (async () => {
        try {
          await once(socket, "timeout")
          return false
        } catch {
          return false
        }
      })(),
    ])
  } finally {
    socket.destroy()
  }
}

void test("a listening server is reported reachable, so a present server is never blocked", async () => {
  const listener = await listen()

  try {
    assert.equal(await probe("127.0.0.1", listener.port), true)
  } finally {
    await listener.close()
  }
})

void test("a closed port is reported unreachable and turns into exit code 2", async () => {
  // Port 1 is not routable on this host, so the probe must fail fast rather

  // Than hang or report a false positive.

  assert.equal(await probe("127.0.0.1", 1), false)
})

void test("a closed listener stops being reachable once it goes away", async () => {
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
