// In-memory metadata store.
// Üretimde PostgreSQL ile değiştir.

const files = new Map();   // fileId → meta
const links = new Map();   // shortId → fileId

export function saveFile(fileId, meta) {
  const record = { id: fileId, createdAt: new Date().toISOString(), ...meta };
  files.set(fileId, record);
  return record;
}

export function getFile(fileId) {
  return files.get(fileId) ?? null;
}

export function registerLink(shortId, fileId) {
  links.set(shortId, fileId);
}

export function resolveLink(shortId) {
  const fileId = links.get(shortId);
  if (!fileId) return null;
  return files.get(fileId) ?? null;
}

export function listFiles() {
  return Array.from(files.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}
