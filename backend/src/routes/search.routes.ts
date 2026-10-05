import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getCachedSenders } from "../services/scheduler.service";
import { searchEmails, reindexFromDb, isSearchDegraded } from "../services/elastic.service";

const router = Router();

router.use(requireAuth);

router.get("/emails", async (req: Request, res: Response) => {
  const q = (req.query.q as string) ?? "";
  const from = parseInt((req.query.from as string) ?? "0", 10) || 0;
  const size = Math.min(parseInt((req.query.size as string) ?? "50", 10) || 50, 200);
  try {
    const result = await searchEmails(q, from, size);
    // Tells the UI to show that results came from the DB, not Elasticsearch.
    res.json({ ...result, degraded: isSearchDegraded() });
  } catch (err) {
    res.status(500).json({ error: "Search unavailable", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/reindex", async (_req: Request, res: Response) => {
  try {
    const count = await reindexFromDb();
    res.json({ ok: true, indexed: count });
  } catch (err) {
    res.status(500).json({ error: "Elasticsearch unavailable", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/senders", async (_req: Request, res: Response) => {
  const senders = await getCachedSenders();
  res.json(senders);
});

export default router;