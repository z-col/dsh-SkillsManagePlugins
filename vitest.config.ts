import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Stub CSS imports (our CSS modules and transitive `.css` files from
  // primitives, e.g. katex) — the node test environment has no CSS loader.
  plugins: [
    {
      name: 'stub-css',
      enforce: 'pre',
      resolveId(id: string) {
        if (id.endsWith('.css')) return id
      },
      load(id: string) {
        if (id.endsWith('.css')) return 'export default {}'
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    server: {
      deps: {
        // The primitives package (and its katex CSS) must go through the
        // vite pipeline so the CSS stub above applies — externalized modules
        // are loaded by Node's native loader, which cannot import `.css`.
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
})
