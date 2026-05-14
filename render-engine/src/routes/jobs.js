import { Router } from 'express';
import { getJob, getAllJobs } from '../store/jobStore.js';

const router = Router();

// GET /api/jobs
router.get('/', (_req, res) => {
  res.json(getAllJobs());
});

// GET /api/jobs/:id
router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job bulunamadı' });
  res.json(job);
});

export default router;
