export class EphemeralRunStore {
  constructor(options = {}) {
    this.kind = "MEMORY";
    this.runs = new Map();
    this.leases = new Set();
    this.now = options.now ?? (() => new Date());
    this.sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.timer.unref?.();
  }

  create(run) {
    if (this.runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.runs.set(run.id, run);
    return run;
  }

  get(id) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (Date.parse(run.expiresAt) <= this.now().getTime()) {
      this.purge(id, "EXPIRED");
      return null;
    }
    return run;
  }

  purge(id, reason = "USER_REQUEST") {
    const run = this.runs.get(id);
    if (!run) return false;
    run.cancelled = true;
    for (const packet of run.packets ?? []) {
      for (const unit of packet.sourceUnits ?? []) {
        unit.content = "";
        if (unit.media) unit.media.data = "";
        unit.transmissionState = "PURGED";
      }
      packet.transmissionState = "PURGED";
    }
    for (const unit of run.localSourceUnits ?? []) {
      unit.content = "";
      if (unit.media) unit.media.data = "";
      unit.transmissionState = "PURGED";
    }
    run.status = reason;
    this.runs.delete(id);
    this.leases.delete(id);
    return true;
  }

  releaseRawEvidence(run) {
    for (const packet of run.packets ?? []) {
      for (const unit of packet.sourceUnits ?? []) {
        unit.content = "";
        if (unit.media) unit.media.data = "";
        unit.transmissionState = "PURGED";
      }
      packet.transmissionState = "PURGED";
    }
    for (const unit of run.localSourceUnits ?? []) {
      unit.content = "";
      if (unit.media) unit.media.data = "";
      unit.transmissionState = "PURGED";
    }
  }

  checkpoint(run) { return run; }

  acquireLease(id) {
    if (!this.get(id) || this.leases.has(id)) return false;
    this.leases.add(id);
    return true;
  }

  renewLease(id) { return Boolean(this.get(id) && this.leases.has(id)); }

  releaseLease(id) { this.leases.delete(id); }

  claimNextQueued() {
    for (const run of this.runs.values()) {
      if (run.status === "QUEUED" && this.acquireLease(run.id)) return run;
    }
    return null;
  }

  sweep() {
    const now = this.now().getTime();
    for (const [id, run] of this.runs) if (Date.parse(run.expiresAt) <= now) this.purge(id, "EXPIRED");
  }

  close() { clearInterval(this.timer); }
}
