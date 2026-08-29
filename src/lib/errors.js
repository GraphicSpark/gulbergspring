// Turn a raw Supabase / Postgres error into a message a user can act on.
// Pass `subject` (e.g. "client", "customer", "account") for a specific line.
export function dbErrorMessage(error, subject = 'record') {
  if (!error) return 'Something went wrong'

  // 23503 = foreign_key_violation - the row is still referenced elsewhere
  if (error.code === '23503') {
    return `Can't delete this ${subject} because it still has orders linked to it. Cancel or move those orders first.`
  }
  // 23505 = unique_violation
  if (error.code === '23505') {
    return `That ${subject} already exists.`
  }

  return error.message || 'Something went wrong'
}
