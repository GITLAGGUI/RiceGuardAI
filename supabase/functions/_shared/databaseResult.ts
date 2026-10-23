type DatabaseResult<T> = { data: T; error: { message: string } | null };

export function checkResult<T>(result: DatabaseResult<T>) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function requireResult<T>(result: DatabaseResult<T>): NonNullable<T> {
  const data = checkResult(result);
  if (data == null) throw new Error("Required database result is missing");
  return data;
}
