import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "../config";
import { User } from "./entities/User";
import { Sender } from "./entities/Sender";
import { EmailJob } from "./entities/EmailJob";
import { SlackIntegration } from "./entities/SlackIntegration";

export const AppDataSource = new DataSource({
  type: "mysql",
  host: config.db.host,
  port: config.db.port,
  username: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ...(config.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  entities: [User, Sender, EmailJob, SlackIntegration],
  synchronize: true,
  charset: "utf8mb4_unicode_ci",
  timezone: "Z",
  logging: process.env.DB_LOGGING === "true",
});

export async function initDb(): Promise<DataSource> {
  if (AppDataSource.isInitialized) return AppDataSource;
  await AppDataSource.initialize();
  return AppDataSource;
}