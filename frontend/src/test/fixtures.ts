import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parsed JSON from the repository's tests/fixtures/ (shared with pytest). */
export function readFixture<T>(...parts: string[]): T {
  return JSON.parse(readFixtureText(...parts)) as T;
}

/** Text of a file in the repository's tests/fixtures/. */
export function readFixtureText(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), 'utf8');
}

export function fixturePath(...parts: string[]): string {
  return resolve(import.meta.dirname, '../../../tests/fixtures', ...parts);
}
