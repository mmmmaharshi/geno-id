const absentValue: undefined = Reflect.get({}, "missing") as undefined
const nullValue: null = JSON.parse("null") as null

export const isMissing = (value: unknown): value is null | undefined =>
  value === nullValue || value === absentValue

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== nullValue

export const isArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value)

const need = <Value>(value: Value | null | undefined): Value => {
  if (isMissing(value)) {
    throw new Error("expected non-null value")
  }
  return value
}

export { absentValue, need, nullValue }
