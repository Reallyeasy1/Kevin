import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('config', () => {
  it('resolves', () => {
    expect(PACKAGE_NAME).toBe('@subbuddy/config');
  });
});
