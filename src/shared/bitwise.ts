const BYTE = 256
const WORD = 65_536

const toUint32 = (x: number): number => {
  const remainder = Math.trunc(x) % 4_294_967_296
  if (remainder < 0) {
    return remainder + 4_294_967_296
  }
  return remainder
}

const toInt32 = (x: number): number => {
  const unsigned = toUint32(x)
  if (unsigned >= 2_147_483_648) {
    return unsigned - 4_294_967_296
  }
  return unsigned
}

const byteAnd = (a: number, b: number): number => {
  let r = 0
  let p = 1
  let x = a
  let y = b
  for (let i = 0; i < 8; i += 1) {
    if (x % 2 === 1 && y % 2 === 1) {
      r += p
    }
    x = Math.trunc(x / 2)
    y = Math.trunc(y / 2)
    p *= 2
  }
  return r
}

const byteXor = (a: number, b: number): number => {
  let r = 0
  let p = 1
  let x = a
  let y = b
  for (let i = 0; i < 8; i += 1) {
    if (x % 2 !== y % 2) {
      r += p
    }
    x = Math.trunc(x / 2)
    y = Math.trunc(y / 2)
    p *= 2
  }
  return r
}

const AND_TABLE = new Uint8Array(WORD)
const XOR_TABLE = new Uint8Array(WORD)
for (let i = 0; i < WORD; i += 1) {
  const a = Math.trunc(i / BYTE)
  const b = i % BYTE
  AND_TABLE[i] = byteAnd(a, b)
  XOR_TABLE[i] = byteXor(a, b)
}

const tableByteAt = (u: number, k: number): number =>
  Math.trunc(u / BYTE ** k) % BYTE

const andNumber = (a: number, b: number): number => {
  const ua = toUint32(a)
  const ub = toUint32(b)
  return toInt32(
    AND_TABLE[(ua % BYTE) * BYTE + (ub % BYTE)] +
      AND_TABLE[tableByteAt(ua, 1) * BYTE + tableByteAt(ub, 1)] * BYTE +
      AND_TABLE[tableByteAt(ua, 2) * BYTE + tableByteAt(ub, 2)] *
        (BYTE * BYTE) +
      AND_TABLE[tableByteAt(ua, 3) * BYTE + tableByteAt(ub, 3)] *
        (BYTE * BYTE * BYTE),
  )
}

const xorNumber = (a: number, b: number): number => {
  const ua = toUint32(a)
  const ub = toUint32(b)
  return toInt32(
    XOR_TABLE[(ua % BYTE) * BYTE + (ub % BYTE)] +
      XOR_TABLE[tableByteAt(ua, 1) * BYTE + tableByteAt(ub, 1)] * BYTE +
      XOR_TABLE[tableByteAt(ua, 2) * BYTE + tableByteAt(ub, 2)] *
        (BYTE * BYTE) +
      XOR_TABLE[tableByteAt(ua, 3) * BYTE + tableByteAt(ub, 3)] *
        (BYTE * BYTE * BYTE),
  )
}

const orNumber = (a: number, b: number): number =>
  toInt32(toUint32(xorNumber(a, b)) + toUint32(andNumber(a, b)))
const notNumber = (a: number): number => toInt32(-toUint32(a) - 1)

const shiftLeftNumber = (a: number, b: number): number => {
  const k = ((Math.trunc(b) % 32) + 32) % 32
  if (k === 0) {
    return toInt32(a)
  }
  const ua = toUint32(a)
  return toInt32((ua % 2 ** (32 - k)) * 2 ** k)
}

const shiftRightUnsignedNumber = (a: number, b: number): number => {
  const k = ((Math.trunc(b) % 32) + 32) % 32
  return Math.trunc(toUint32(a) / 2 ** k)
}

const shiftRightSignedNumber = (a: number, b: number): number => {
  const k = ((Math.trunc(b) % 32) + 32) % 32
  return Math.floor(toInt32(a) / 2 ** k)
}

const bitLength = (x: bigint): number => {
  if (x === 0n) {
    return 0
  }
  if (x < 0n) {
    return (-x).toString(2).length
  }
  return x.toString(2).length
}

const andBigInt = (a: bigint, b: bigint): bigint => {
  const width = Math.max(bitLength(a), bitLength(b), 1) + 1
  const mod = 2n ** BigInt(width)
  const ua = ((a % mod) + mod) % mod
  const ub = ((b % mod) + mod) % mod
  let r = 0n
  for (let i = 0; i < width; i += 1) {
    const pa = (ua / 2n ** BigInt(i)) % 2n
    const pb = (ub / 2n ** BigInt(i)) % 2n
    if (pa === 1n && pb === 1n) {
      r += 2n ** BigInt(i)
    }
  }
  if (r >= 2n ** BigInt(width - 1)) {
    r -= mod
  }
  return r
}

const orBigInt = (a: bigint, b: bigint): bigint => {
  const width = Math.max(bitLength(a), bitLength(b), 1) + 1
  const mod = 2n ** BigInt(width)
  const ua = ((a % mod) + mod) % mod
  const ub = ((b % mod) + mod) % mod
  let r = 0n
  for (let i = 0; i < width; i += 1) {
    const pa = (ua / 2n ** BigInt(i)) % 2n
    const pb = (ub / 2n ** BigInt(i)) % 2n
    if (pa === 1n || pb === 1n) {
      r += 2n ** BigInt(i)
    }
  }
  if (r >= 2n ** BigInt(width - 1)) {
    r -= mod
  }
  return r
}

const xorBigInt = (a: bigint, b: bigint): bigint => {
  const width = Math.max(bitLength(a), bitLength(b), 1) + 1
  const mod = 2n ** BigInt(width)
  const ua = ((a % mod) + mod) % mod
  const ub = ((b % mod) + mod) % mod
  let r = 0n
  for (let i = 0; i < width; i += 1) {
    const pa = (ua / 2n ** BigInt(i)) % 2n
    const pb = (ub / 2n ** BigInt(i)) % 2n
    if (pa !== pb) {
      r += 2n ** BigInt(i)
    }
  }
  if (r >= 2n ** BigInt(width - 1)) {
    r -= mod
  }
  return r
}

const notBigInt = (a: bigint): bigint => -a - 1n

const shiftLeftBigInt = (a: bigint, b: bigint): bigint => {
  if (b < 0n) {
    throw new RangeError("negative shift count")
  }
  return a * 2n ** b
}

const shiftRightBigInt = (a: bigint, b: bigint): bigint => {
  if (b < 0n) {
    throw new RangeError("negative shift count")
  }
  const p = 2n ** b
  if (a >= 0n) {
    return a / p
  }
  return -((-a + p - 1n) / p)
}

const shiftRightUnsignedBigInt = (a: bigint, b: bigint): bigint => {
  if (b < 0n) {
    throw new RangeError("negative shift count")
  }
  const mod = 2n ** 64n
  const u = ((a % mod) + mod) % mod
  return u / 2n ** b
}

interface AndBits {
  (a: number, b: number): number
  (a: number | bigint, b: number | bigint): bigint
}
interface NotBits {
  (a: number): number
  (a: number | bigint): bigint
}
interface ShiftLeft {
  (a: number, b: number): number
  (a: number | bigint, b: number | bigint): bigint
}

export const andBits: AndBits = function andBits(
  a: number | bigint,
  b: number | bigint,
): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return andBigInt(BigInt(a), BigInt(b))
  }
  return andNumber(a, b)
} as AndBits

export const orBits: AndBits = function orBits(
  a: number | bigint,
  b: number | bigint,
): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return orBigInt(BigInt(a), BigInt(b))
  }
  return orNumber(a, b)
} as AndBits

export const xorBits: AndBits = function xorBits(
  a: number | bigint,
  b: number | bigint,
): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return xorBigInt(BigInt(a), BigInt(b))
  }
  return xorNumber(a, b)
} as AndBits

export const notBits: NotBits = function notBits(
  a: number | bigint,
): number | bigint {
  if (typeof a === "bigint") {
    return notBigInt(a)
  }
  return notNumber(a)
} as NotBits

export const shiftLeftBits: ShiftLeft = function shiftLeftBits(
  a: number | bigint,
  b: number | bigint,
): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return shiftLeftBigInt(BigInt(a), BigInt(b))
  }
  return shiftLeftNumber(a, b)
} as ShiftLeft

export const shiftRightBits: ShiftLeft = function shiftRightBits(
  a: number | bigint,
  b: number | bigint,
): number | bigint {
  if (typeof a === "bigint" || typeof b === "bigint") {
    return shiftRightBigInt(BigInt(a), BigInt(b))
  }
  return shiftRightSignedNumber(a, b)
} as ShiftLeft

export const shiftRightUnsignedBits: ShiftLeft =
  function shiftRightUnsignedBits(
    a: number | bigint,
    b: number | bigint,
  ): number | bigint {
    if (typeof a === "bigint" || typeof b === "bigint") {
      return shiftRightUnsignedBigInt(BigInt(a), BigInt(b))
    }
    return shiftRightUnsignedNumber(a, b)
  } as ShiftLeft

export const and32 = andNumber
export const xor32 = xorNumber
export const or32 = orNumber
export const xorByte = (a: number, b: number): number => XOR_TABLE[a * BYTE + b]
