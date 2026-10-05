import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { dateTimeType } from "../columnTypes";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255, nullable: true })
  googleId: string | null;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  avatarUrl: string | null;

  @CreateDateColumn({ type: dateTimeType })
  createdAt: Date;

  @UpdateDateColumn({ type: dateTimeType })
  updatedAt: Date;
}