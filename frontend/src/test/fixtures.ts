import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parsed JSON from the repository's tests/fixtures/ (shared with pytest). */
export function readFixture<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as T;
}

export function fixturePath(...parts: string[]): string {
  return resolve(import.meta.dirname, '../../../tests/fixtures', ...parts);
}
