import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests never use the real AI keys in server/.env (dotenv doesn't override variables that are
    // already set, even to empty), so they never call a paid service or depend on local setup.
    env: { VERTEX_API_KEY: '', VERTEX_PROJECT: '', VERTEX_KEY_FILE: '/nonexistent/vertex-key.json', AI_FAKE: '' },
  },
});
