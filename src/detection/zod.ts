export function isZodSchema(schema: unknown): boolean {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_def' in schema &&
    'safeParse' in schema &&
    typeof (schema as Record<string, unknown>).safeParse === 'function'
  );
}
