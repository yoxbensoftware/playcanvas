import fs from 'fs';
import path from 'path';
import config from '../config.js';

const files = new Map();   // fileId -> meta
const links = new Map();   // shortId -> fileId
const storeFile = path.join(config.dataDir, 'metadata.json');

function loadStore() {
  try {
    if (!fs.existsSync(storeFile)) return;
    const raw = fs.readFileSync(storeFile, 'utf8');
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw);
    for (const record of parsed.files || []) {
      if (record?.id) files.set(record.id, record);
    }
    for (const [shortId, fileId] of parsed.links || []) {
      links.set(shortId, fileId);
    }
  } catch (err) {
    console.warn(`[fileStore] metadata load warning: ${err.message}`);
  }
}

function persistStore() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const payload = {
      files: Array.from(files.values()),
      links: Array.from(links.entries()),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(storeFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[fileStore] metadata persist warning: ${err.message}`);
  }
}

loadStore();

export function saveFile(fileId, meta) {
  const record = { id: fileId, createdAt: new Date().toISOString(), ...meta };
  files.set(fileId, record);
  persistStore();
  return record;
}

export function getFile(fileId) {
  return files.get(fileId) ?? null;
}

export function registerLink(shortId, fileId) {
  links.set(shortId, fileId);
  persistStore();
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
