/**
 * BackupEngine.js — BOSS AI Personal Productivity Hub v1.0
 * Validated JSON export/import, storage usage metering, destructive-reset guard.
 *
 * - exportData(): full state tree JSON with meta headers (version, exportedAt, schemaVersion).
 * - importData(): STRICT structural + type validation BEFORE any storage mutation.
 *   Corrupted or malformed payloads are rejected without altering active state.
 * - calculateStorageUsage(): estimate with 80% threshold warning flag.
 *
 * DOM-free domain module (file download triggers are orchestrated by app.js).
 */

import { SCHEMA_VERSION } from './StorageAdapter.js';
import { PRIORITIES, STATUSES } from './TaskEngine.js';
import { PROJECT_STATUSES } from './ProjectEngine.js';

export const BACKUP_APP_ID = 'boss-ai-hub';
export const BACKUP_VERSION = '1.0';
export const BACKUP_SCHEMA_VERSION = 2; // v2: rev/deletedAt/originDeviceId sync metadata
export const BACKUP_COLLECTIONS = ['tasks', 'projects', 'notes', 'settings', 'workspaces'];
const WARNING_THRESHOLD = 0.8;
const LOCAL_QUOTA_ESTIMATE = 5 * 1024 * 1024; // LocalStorage heuristic (chars ≈ UTF-16 units)

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export default class BackupEngine {
  /** @param {import('./StorageAdapter.js').default} storage */
  constructor(storage) {
    if (!storage) throw new TypeError('BackupEngine requires a StorageAdapter');
    this.storage = storage;
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  /** Compiles every collection into a validated, meta-headed JSON string. */
  async exportData() {
    const data = {};
    for (const collection of BACKUP_COLLECTIONS) {
      // includeDeleted: tombstones must travel so deletions survive restore/sync.
      data[collection] = await this.storage.list(collection, null, { includeDeleted: true });
    }
    const payload = {
      meta: {
        app: BACKUP_APP_ID,
        version: BACKUP_VERSION,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        deviceId: (this.storage.identity && this.storage.identity.deviceId) || 'local-device',
        exportedAt: new Date().toISOString(),
      },
      data,
    };
    return JSON.stringify(payload, null, 2);
  }

  /** File-friendly export: { fileName, text } ready for a Blob download. */
  async exportAsFile() {
    const text = await this.exportData();
    const stamp = new Date().toISOString().slice(0, 10);
    return { fileName: `boss-ai-backup-${stamp}.json`, text };
  }

  /* ------------------------------------------------------------------ */
  /* Import (validate first — mutate never-before-valid)                 */
  /* ------------------------------------------------------------------ */

  /**
   * @param {string} jsonString
   * @param {{mode?: 'replace'}} [options] default 'replace' (full restore)
   * @returns {Promise<{ok: boolean, mode: string, imported: Object<string, number>|null, errors: string[]}>}
   */
  async importData(jsonString, options = {}) {
    const mode = options.mode === 'merge' ? 'merge' : 'replace';
    const errors = [];

    let parsed;
    try {
      parsed = JSON.parse(String(jsonString));
    } catch (_) {
      return { ok: false, mode, imported: null, errors: ['payload: not valid JSON'] };
    }

    this._validateBackup(parsed, errors);

    if (errors.length) {
      // CRITICAL: rejection happens before ANY storage mutation.
      return { ok: false, mode, imported: null, errors };
    }

    const imported = {};
    for (const collection of BACKUP_COLLECTIONS) {
      // Backfill Phase 5a sync metadata so v1 archives restore cleanly.
      const records = (Array.isArray(parsed.data[collection]) ? parsed.data[collection] : []).map((row) => ({
        ...row,
        rev: Number.isInteger(row.rev) && row.rev > 0 ? row.rev : 1,
        deletedAt: row.deletedAt || null,
        originDeviceId: row.originDeviceId || 'imported',
      }));
      if (mode === 'merge') {
        for (const record of records) {
          await this.storage.put(collection, record, { preserveStamps: true });
        }
        imported[collection] = records.length;
      } else {
        imported[collection] = await this.storage.replaceCollection(collection, records);
      }
    }
    return { ok: true, mode, imported, errors: [] };
  }

  /** Structural + type schema validation. Pushes human-readable strings into `errors`. */
  _validateBackup(parsed, errors) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('payload: root must be a JSON object');
      return;
    }
    const meta = parsed.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      errors.push('meta: missing or not an object');
    } else {
      if (meta.app !== BACKUP_APP_ID) errors.push(`meta.app: must be '${BACKUP_APP_ID}'`);
      if (typeof meta.version !== 'string' || !meta.version.trim()) errors.push('meta.version: non-empty string required');
      if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1) {
        errors.push('meta.schemaVersion: positive integer required');
      } else if (meta.schemaVersion > BACKUP_SCHEMA_VERSION) {
        errors.push(`meta.schemaVersion: backup ${meta.schemaVersion} is newer than runtime ${BACKUP_SCHEMA_VERSION} — refusing to import`);
      }
      if (!isIsoDate(meta.exportedAt)) errors.push('meta.exportedAt: ISO 8601 date string required');
    }

    const data = parsed.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push('data: missing or not an object');
      return;
    }

    const checkRecords = (collection, fields) => {
      const rows = data[collection];
      if (rows === undefined) return; // optional collections tolerated as empty
      if (!Array.isArray(rows)) {
        errors.push(`data.${collection}: must be an array`);
        return;
      }
      rows.forEach((row, i) => {
        const at = `data.${collection}[${i}]`;
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          errors.push(`${at}: must be an object`);
          return;
        }
        if (typeof row.id !== 'string' || !row.id.trim()) errors.push(`${at}.id: non-empty string required`);
        if (row.rev !== undefined && (!Number.isInteger(row.rev) || row.rev < 1)) errors.push(`${at}.rev: positive integer required`);
        if (row.deletedAt !== undefined && row.deletedAt !== null && !isIsoDate(row.deletedAt)) errors.push(`${at}.deletedAt: ISO 8601 string or null required`);
        for (const field of fields.strings) {
          if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') errors.push(`${at}.${field}: must be a string`);
        }
        for (const field of fields.requiredStrings) {
          if (typeof row[field] !== 'string' || !row[field].trim()) errors.push(`${at}.${field}: non-empty string required`);
        }
        if (fields.tags && row.tags !== undefined && !Array.isArray(row.tags)) errors.push(`${at}.tags: must be an array`);
        if (fields.enum) {
          for (const [field, allowed] of Object.entries(fields.enum)) {
            if (row[field] !== undefined && !allowed.includes(row[field])) {
              errors.push(`${at}.${field}: must be one of ${allowed.join(' | ')}`);
            }
          }
        }
        if (fields.booleans) {
          for (const field of fields.booleans) {
            if (row[field] !== undefined && typeof row[field] !== 'boolean') errors.push(`${at}.${field}: must be a boolean`);
          }
        }
        if (fields.dates) {
          for (const field of fields.dates) {
            if (row[field] !== undefined && row[field] !== null && !isIsoDate(row[field])) {
              errors.push(`${at}.${field}: must be an ISO 8601 string or null`);
            }
          }
        }
      });
    };

    checkRecords('tasks', {
      requiredStrings: ['title'],
      strings: ['description'],
      tags: true,
      enum: { priority: PRIORITIES, status: STATUSES },
      dates: ['dueDate'],
    });
    checkRecords('projects', {
      requiredStrings: ['name'],
      strings: ['description'],
      tags: true,
      enum: { status: PROJECT_STATUSES },
    });
    checkRecords('notes', {
      requiredStrings: [],
      strings: ['title', 'content'],
      tags: true,
      booleans: ['isPinned'],
    });
    checkRecords('settings', { requiredStrings: [], strings: [], tags: false });
    checkRecords('workspaces', {
      requiredStrings: ['name'],
      strings: ['description', 'packId'],
      enum: { status: ['active', 'archived'] },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Storage metering & destructive reset                                */
  /* ------------------------------------------------------------------ */

  /**
   * Estimates active client storage consumption.
   * Uses navigator.storage.estimate() when available, else a LocalStorage char heuristic.
   * @returns {Promise<{usedBytes: number, quotaBytes: number, ratio: number, warning: boolean, source: string}>}
   */
  async calculateStorageUsage() {
    let used = 0;
    for (const collection of BACKUP_COLLECTIONS) {
      used += await this.storage.collectionSize(collection);
    }
    let quota = LOCAL_QUOTA_ESTIMATE;
    let source = 'localstorage-char-heuristic';
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        if (est && Number.isFinite(est.quota) && est.quota > 0) {
          quota = est.quota;
          if (Number.isFinite(est.usage)) used = est.usage;
          source = 'navigator.storage.estimate';
        }
      }
    } catch (_) {
      /* keep heuristic */
    }
    const ratio = quota > 0 ? Math.min(used / quota, 1) : 0;
    return {
      usedBytes: used,
      quotaBytes: quota,
      ratio,
      warning: ratio >= WARNING_THRESHOLD,
      source,
    };
  }

  /** Destructive: wipes every collection. UI MUST confirm via modal first. */
  async resetAllData() {
    const cleared = {};
    for (const collection of BACKUP_COLLECTIONS) {
      const rows = await this.storage.list(collection);
      cleared[collection] = rows.length;
      await this.storage.clearCollection(collection);
    }
    return cleared;
  }
}
