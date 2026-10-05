import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

/**
 * True on a real deployment. NODE_ENV is not always set by PaaS providers, so
 * the presence of a platform host var is treated as production too.
 */
function isDeployed(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER_EXTERNAL_URL ?? process.env.RENDER_EXTERNAL_HOSTNAME)
  );
}

function isLocalOrigin(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url.trim());
}

/**
 * The public origin this process is reachable at. Render (and most PaaS
 * providers) expose it as a well-known var; falls back to BACKEND_URL.
 */
function publicOrigin(): string {
  const candidate =
    process.env.RENDER_EXTERNAL_URL ??
    process.env.RENDER_EXTERNAL_HOSTNAME ??
    process.env.BACKEND_URL ??
    "http://localhost:4000";
  return candidate.startsWith("http") ? candidate : `https://${candidate}`;
}

/**
 * A localhost URL is never a valid deployment value: it sends the browser off
 * the deployed host after sign-in. Ignore it when deployed and derive the real
 * origin instead, so a stale env var cannot break OAuth.
 */
function publicUrl(explicit: string | undefined): string {
  if (explicit && !(isDeployed() && isLocalOrigin(explicit))) return explicit.trim();
  return publicOrigin();
}

function callbackUri(explicit: string | undefined, path: string): string {
  return `${publicUrl(explicit) ?? publicOrigin()}${path}`;
}

function required(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return val;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",

  port: parseInt(process.env.PORT ?? "4000", 10),

  // Deployed builds serve the built SPA from this same process, so the public
  // origin is the right default for both. Local dev overrides these.
  frontendUrl: publicUrl(process.env.FRONTEND_URL),
  backendUrl: publicUrl(process.env.BACKEND_URL),

  redis: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  },

  db: {
    /** "mysql" (default) or "postgres" — picked from the managed DB provider. */
    client: (process.env.DB_CLIENT ?? "mysql") as "mysql" | "postgres",
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? (process.env.DB_CLIENT === "postgres" ? "5432" : "3307"), 10),
    user: process.env.DB_USER ?? "reachinbox",
    password: process.env.DB_PASSWORD ?? "reachinbox",
    database: process.env.DB_NAME ?? "reachinbox",
    ssl: process.env.DB_SSL === "true",
  },

  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
    index: process.env.ELASTICSEARCH_INDEX ?? "reachinbox_emails",
  },

  smtp: {
    // If ETHEREAL_HOST is set, use a fixed Ethereal account (recommended so the
    // same mailbox is reused across restarts). Otherwise a fresh Ethereal
    // account is created at runtime and its credentials are logged.
    host: process.env.ETHEREAL_HOST,
    port: parseInt(process.env.ETHEREAL_PORT ?? "587", 10),
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
    from: process.env.EMAIL_FROM,
  },

  scheduler: {
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10),
    minDelayBetweenEmailsMs: parseInt(process.env.MIN_DELAY_BETWEEN_EMAILS_MS ?? "2000", 10),
    maxEmailsPerHour: parseInt(process.env.MAX_EMAILS_PER_HOUR ?? "200", 10),
    maxEmailsPerHourPerSender: parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? "60", 10),
    jobAttempts: parseInt(process.env.JOB_ATTEMPTS ?? "6", 10),
  },

  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: callbackUri(process.env.GOOGLE_REDIRECT_URI, "/api/auth/google/callback"),
    jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  },

  slack: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    redirectUri: callbackUri(process.env.SLACK_REDIRECT_URI, "/api/slack/oauth/callback"),
    channel: process.env.SLACK_CHANNEL ?? "#reachinbox-alerts",
    signSecret: process.env.SLACK_SIGNING_SECRET,
  },
};

export type AppConfig = typeof config;