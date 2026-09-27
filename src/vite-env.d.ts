/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the API lives, when the client is hosted somewhere else (GitHub
   * Pages). Unset means the same origin, which is how development runs.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
