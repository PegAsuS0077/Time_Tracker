import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Strict Content-Security-Policy, injected only into production builds
 * (the dev server relies on inline scripts for HMR).
 * GitHub Pages cannot set response headers, so this is a <meta> CSP.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: env.BASE ?? '/',
    plugins: [cspPlugin()],
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
