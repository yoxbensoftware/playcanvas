// In-memory job store.
// Üretimde Redis veya PostgreSQL ile değiştir.

const jobs = new Map();

export function createJob(id, data) {
  const job = {
    id,
    status: 'queued',   // queued | extracting | processing | done | failed
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data,
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id, updates) {
  const job = jobs.get(id);
  if (!job) return null;
  const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
  jobs.set(id, updated);
  return updated;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function getAllJobs() {
  return Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}
