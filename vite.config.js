import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleOpenRouterRequest } from './server/openrouterHandler.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (mode === 'development' && !process.env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY
  }

  return {
    plugins: [
      react(),
      {
        name: 'local-openrouter-api',
        configureServer(server) {
          server.middlewares.use('/api/openrouter', (request, response, next) => {
            void handleOpenRouterRequest(request, response).catch(next)
          })
        },
      },
    ],
  }
})
