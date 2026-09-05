import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('database', () => {
  it('resolves', () => {
    expect(PACKAGE_NAME).toBe('@subbuddy/database');
  });
});
