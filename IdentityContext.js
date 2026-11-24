/**
 * IdentityContext.js — BOSS AI Phase 5a (flat-root module)
 * Single source of identity for tenancy and sync metadata.
 *
 * - ownerId / tenantId keep the proven defaults (local-owner / default-tenant).
 * - actorId / actorRole describe WHO is acting (future role gates).
 * - deviceId labels which device produced a mutation (sync forensics).
 *
 * DOM-free, dependency-free, deterministic defaults (safe for harness tests).
 */

export const IDENTITY_ROLES = ['owner', 'member', 'viewer'];
export const DEFAULT_OWNER_ID = 'local-owner';
export const DEFAULT_TENANT_ID = 'default-tenant';
export const DEFAULT_DEVICE_ID = 'local-device';

export default class IdentityContext {
  /**
   * @param {{ownerId?: string, tenantId?: string, actorId?: string,
   *          actorRole?: string, deviceId?: string}} [options]
   */
  constructor(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    this.ownerId = typeof opts.ownerId === 'string' && opts.ownerId.trim() ? opts.ownerId : DEFAULT_OWNER_ID;
    this.tenantId = typeof opts.tenantId === 'string' && opts.tenantId.trim() ? opts.tenantId : DEFAULT_TENANT_ID;
    this.actorId = typeof opts.actorId === 'string' && opts.actorId.trim() ? opts.actorId : this.ownerId;
    this.actorRole = IDENTITY_ROLES.includes(opts.actorRole) ? opts.actorRole : 'owner';
    this.deviceId = typeof opts.deviceId === 'string' && opts.deviceId.trim() ? opts.deviceId : DEFAULT_DEVICE_ID;
  }

  /** Plain snapshot (safe to serialize — contains no secrets by design). */
  snapshot() {
    return {
      ownerId: this.ownerId,
      tenantId: this.tenantId,
      actorId: this.actorId,
      actorRole: this.actorRole,
      deviceId: this.deviceId,
    };
  }

  toJSON() {
    return this.snapshot();
  }

  /** Duck-type tolerant coercion: instance | plain object | undefined. */
  static from(value) {
    if (value instanceof IdentityContext) return value;
    return new IdentityContext(value || {});
  }
}
