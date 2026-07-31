export function createRateMeter(sampleMs: number) {
  let startedAt: number | null = null;
  let count = 0;

  return {
    push(at: number, amount = 1) {
      if (startedAt === null) {
        startedAt = at;
        return null;
      }

      count += amount;
      const elapsed = at - startedAt;
      if (elapsed < sampleMs) return null;

      const rate = (count * 1_000) / elapsed;
      startedAt = at;
      count = 0;
      return rate;
    },
    reset() {
      startedAt = null;
      count = 0;
    },
  };
}
