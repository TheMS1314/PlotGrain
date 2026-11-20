import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        study: fileURLToPath(new URL('./study/index.html', import.meta.url)),
        designReview: fileURLToPath(new URL('./design-review/index.html', import.meta.url)),
        projects: fileURLToPath(new URL('./projects/index.html', import.meta.url)),
        profile: fileURLToPath(new URL('./profile/index.html', import.meta.url)),
        signIn: fileURLToPath(new URL('./sign-in/index.html', import.meta.url)),
      },
    },
  },
})
