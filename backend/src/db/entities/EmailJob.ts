import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type EmailJobStatus = "scheduled" | "processing" | "sent" | "failed" | "deferred";

@Entity("email_jobs")
export class EmailJob {
  /** Primary key. Also used as the BullMQ `jobId` to guarantee idempotency. */
  @PrimaryColumn({ type: "varchar", length: 64 })
  id: string;

  @Index()
  @Column({ type: "varchar", length: 64, nullable: true })
  batchId: string | null;

  @Index()
  @Column({ type: "varchar", length: 64, nullable: true })
  userId: string | null;

  @Index()
  @Column({ type: "varchar", length: 64 })
  senderId: string;

  @Index()
  @Column({ type: "varchar", length: 255 })
  recipient: string;

  @Column({ type: "text" })
  subject: string;

  @Column({ type: "longtext" })
  body: string;

  @Index()
  @Column({ type: "varchar", length: 20, default: "scheduled" })
  status: EmailJobStatus;

  @Index()
  @Column({ type: "datetime" })
  scheduledAt: Date;

  @Column({ type: "datetime", nullable: true })
  sentAt: Date | null;

  @Column({ type: "text", nullable: true })
  error: string | null;

  @Column({ type: "int", default: 0 })
  attempts: number;

  /** Position inside its batch — used to preserve relative order on rate-limit deferral. */
  @Column({ type: "int", default: 0 })
  batchIndex: number;

  /**
   * Id of the BullMQ job that currently owns this row. Used for idempotency
   * (stale jobs arriving for an old id are ignored) and for restart
   * reconciliation (re-enqueue only if this exact job is missing in Redis).
   */
  @Column({ type: "varchar", length: 64, nullable: true })
  queueJobId: string | null;

  /** External id provided by the SMTP provider after a successful send. */
  @Column({ type: "varchar", length: 500, nullable: true })
  providerMessageId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}