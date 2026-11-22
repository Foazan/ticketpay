/** True when a database error is a unique-constraint violation (Postgres 23505). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** True when a CHECK constraint rejected the write (Postgres 23514). */
export function isCheckViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23514' || e?.cause?.code === '23514';
}
