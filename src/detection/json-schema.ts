export function isJSONSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const s = schema as Record<string, unknown>;
  return '$schema' in s || 'type' in s || 'properties' in s || 'items' in s || 'allOf' in s || 'anyOf' in s || 'oneOf' in s;
}
