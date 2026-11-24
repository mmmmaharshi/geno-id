export const sequence = (count: number): Iterable<number> => ({
  *[Symbol.iterator](): Generator<number> {
    for (let index = 0; index < count; index += 1) {
      yield index
    }
  },
})

const visitSequential = async (
  index: number,
  count: number,
  visit: (index: number) => Promise<void>,
): Promise<void> => {
  if (index >= count) {
    return
  }
  await visit(index)
  await visitSequential(index + 1, count, visit)
}

export const forEachSequential = async (
  count: number,
  visit: (index: number) => Promise<void>,
): Promise<void> => {
  await visitSequential(0, count, visit)
}
