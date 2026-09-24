import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("senders")
export class Sender {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Index()
  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  userId: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  smtpConfig: string | null;

  /** Per-sender hourly cap. Falls back to MAX_EMAILS_PER_HOUR_PER_SENDER when null. */
  @Column({ type: "int", nullable: true })
  hourlyLimit: number | null;

  @Column({ type: "boolean", default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}