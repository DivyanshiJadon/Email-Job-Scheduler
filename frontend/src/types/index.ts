export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  avatar: string | null;
}

export type EmailStatus = "scheduled" | "deferred" | "processing" | "sent" | "failed";

export interface EmailJob {
  id: string;
  batchId: string | null;
  userId: string | null;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  error: string | null;
  attempts: number;
  batchIndex: number;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailListResponse {
  data: EmailJob[];
  total: number;
}

export interface ScheduleResponse {
  batchId: string;
  total: number;
  valid: number;
  alreadyScheduled: number;
  firstScheduledAt: string | null;
}

export interface SchedulePayload {
  subject: string;
  body: string;
  leads?: string[];
  csvText?: string;
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit?: number;
  senderId?: string;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  userId: string | null;
  active: boolean;
  hourlyLimit?: number | null;
}

export interface SearchHit {
  jobId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  score?: number;
}

export interface SearchResponse {
  total: number;
  hits: SearchHit[];
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channel?: string;
}

export interface UserResponse {
  user: AuthUser;
}