import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Public demo build (VITE_MODE=mock): keep it out of search engines with a
 * noindex meta tag and a robots.txt that disallows everything.
 */
function demoBuild(isDemo) {
  return {
    name: 'dash-demo-build',
    transformIndexHtml() {
      if (!isDemo) return
      return [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex,nofollow' }, injectTo: 'head' }]
    },
    generateBundle() {
      if (!isDemo) return
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' })
    },
  }
}

export default defineConfig(({ mode }) => {
  // '' prefix: also read VITE_MODE from the process environment (Docker build args).
  const env = loadEnv(mode, process.cwd(), '')
  const isDemo = env.VITE_MODE === 'mock'

  return {
    plugins: [vue(), tailwindcss(), demoBuild(isDemo)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5173,
    },
  }
})
