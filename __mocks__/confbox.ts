export function parseJSONC(content: string): unknown {
  // Simple JSONC parser for tests - strips comments and parses JSON
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '')          // Remove line comments
    .replace(/,(\s*[}\]])/g, '$1');    // Remove trailing commas

  try {
    return JSON.parse(stripped);
  } catch {
    return {};
  }
}

export function stringifyJSONC(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
