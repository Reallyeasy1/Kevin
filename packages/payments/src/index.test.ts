import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('payments', () => {
  it('resolves', () => {
    expect(PACKAGE_NAME).toBe('@subbuddy/payments');
  });
});
