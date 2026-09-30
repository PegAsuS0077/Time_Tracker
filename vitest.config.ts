import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Pin the process timezone to something other than Berlin so tests
    // prove the domain logic does not depend on the device timezone.
    env: { TZ: 'America/New_York' },
  },
});
