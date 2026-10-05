import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "../config";
import { User } from "./entities/User";
import { Sender } from "./entities/Sender";
import { EmailJob } from "./entities/EmailJob";
import { SlackIntegration } from "./entities/SlackIntegration";

/**
 * MySQL and Postgres differ in connection options and charset handling, so the
 * driver is selected via `DB_CLIENT`. Column types that differ are resolved in
 * `./columnTypes`.
 */
const postgres = config.db.client === "postgres";

export const AppDataSource = new DataSource({
  type: postgres ? "postgres" : "mysql",
  host: config.db.host,
  port: config.db.port,
  username: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ...(config.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  entities: [User, Sender, EmailJob, SlackIntegration],
  synchronize: true,
  ...(postgres ? {} : { charset: "utf8mb4_unicode_ci", timezone: "Z" }),
  logging: process.env.DB_LOGGING === "true",
});

export async function initDb(): Promise<DataSource> {
  if (AppDataSource.isInitialized) return AppDataSource;
  await AppDataSource.initialize();
  return AppDataSource;
}