import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { dateTimeType } from "../columnTypes";

@Entity("slack_integrations")
export class SlackIntegration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  userId: string;

  @Column({ type: "varchar", length: 255 })
  teamId: string;

  @Column({ type: "varchar", length: 255 })
  teamName: string;

  @Column({ type: "varchar", length: 255 })
  channel: string;

  @Column({ type: "text" })
  accessToken: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  botUserId: string | null;

  @Column({ type: "boolean", default: true })
  active: boolean;

  @CreateDateColumn({ type: dateTimeType })
  createdAt: Date;

  @UpdateDateColumn({ type: dateTimeType })
  updatedAt: Date;
}