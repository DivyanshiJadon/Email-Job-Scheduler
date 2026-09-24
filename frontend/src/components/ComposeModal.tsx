import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Input } from "./Input";
import { TextArea } from "./TextArea";
import { Button } from "./Button";
import { api } from "../lib/api";
import { extractEmails } from "../lib/csv";
import { useToast } from "./Toast";
import type { Sender } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [startTime, setStartTime] = useState(() => toLocalInputValue(new Date(Date.now() + 5 * 60_000)));
  const [delayBetweenEmails, setDelayBetweenEmails] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(60);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const emails = extractEmails(csvText);
  const emailCount = emails.length;

  useEffect(() => {
    if (open) {
      setSubject("");
      setBody("");
      setFileName(null);
      setCsvText("");
      setFileError(null);
      setStartTime(toLocalInputValue(new Date(Date.now() + 5 * 60_000)));
      if (fileRef.current) fileRef.current.value = "";
      void api.senders
        .list()
        .then((s) => {
          setSenders(s);
          setSenderId(s[0]?.id ?? "");
        })
        .catch(() => setSenders([]));
    }
  }, [open]);

  async function handleFile(file: File) {
    setFileError(null);
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
    } catch {
      setFileError("Could not read that file.");
    }
  }

  async function handleSubmit() {
    if (!subject.trim() || !body.trim()) {
      toast("error", "Subject and body are required.");
      return;
    }
    if (emailCount === 0) {
      setFileError("No valid email addresses found in the uploaded file.");
      toast("error", "Upload a CSV/text file containing email addresses.");
      return;
    }

    setSubmitting(true);
    try {
      const parsedDelay = Number(delayBetweenEmails);
      const res = await api.emails.schedule({
        subject: subject.trim(),
        body,
        csvText,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmails: Number.isFinite(parsedDelay) ? parsedDelay : 2,
        hourlyLimit,
        senderId: senderId || undefined,
      });
      toast("success", `Scheduled ${res.total} email${res.total === 1 ? "" : "s"} (batch ${res.batchId}).`);
      onScheduled();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to schedule emails.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Compose new email"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={emailCount === 0}>
            Schedule {emailCount > 0 ? `${emailCount} email${emailCount === 1 ? "" : "s"}` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Re: Exciting opportunity"
          maxLength={500}
        />

        <TextArea
          label="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Write your email content (HTML or plain text)…"
        />

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-300">Email leads</span>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 bg-ink-800/60 px-4 py-6 text-sm text-ink-400 transition-colors hover:border-brand-400/60 hover:text-ink-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            Upload CSV / text file of leads
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,.text,.eml,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
          {fileName && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2 text-sm">
              <span className="truncate text-ink-200">{fileName}</span>
              <span className="ml-3 shrink-0 font-semibold text-brand-300">
                {emailCount} email{emailCount === 1 ? "" : "s"} detected
              </span>
            </div>
          )}
          {fileError && <p className="mt-1 text-xs text-red-400">{fileError}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Start time"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            label="Delay between emails (s)"
            type="number"
            min={0}
            max={3600}
            value={delayBetweenEmails}
            onChange={(e) => setDelayBetweenEmails(Number(e.target.value))}
            hint={`Min enforced: 2s`}
          />
          <Input
            label="Hourly limit"
            type="number"
            min={1}
            max={10000}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
            hint="Per-sender emails/hour"
          />
        </div>

        {senders.length > 0 && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-300">Sender (Ethereal mailbox)</span>
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-ink-100 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} &lt;{s.email}&gt;
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}