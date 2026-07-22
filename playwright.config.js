import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  use: { baseURL: 'http://localhost:8080' },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
  },
});
