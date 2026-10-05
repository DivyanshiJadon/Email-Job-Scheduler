/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when the frontend is hosted separately from the API. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
