const TypeBoxKind = Symbol.for('TypeBox.Kind');

export function isTypeBoxSchema(schema: unknown): boolean {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    TypeBoxKind in (schema as object)
  );
}
