import type { ColumnType } from "typeorm";
import { config } from "../config";

/**
 * Column types that differ between MySQL and Postgres. Entities reference these
 * instead of hardcoding one driver's type, so the same entities work against
 * either database (see `DB_CLIENT`).
 */
const postgres = config.db.client === "postgres";

/** UTC instant. MySQL stores naive `datetime`, Postgres needs an explicit zone. */
export const dateTimeType: ColumnType = postgres ? "timestamptz" : "datetime";

/** Unbounded text: `longtext` on MySQL, plain `text` on Postgres. */
export const longTextType: ColumnType = postgres ? "text" : "longtext";