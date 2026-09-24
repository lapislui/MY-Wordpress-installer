const fs = require("fs");
const path = require("path");
const { safeStorage, BrowserWindow } = require("electron");

// Storage keys
const SECRETS_KEY = "wpdesktop.cloud-sync.secrets";
const QUEUE_KEY = "wpdesktop.cloud-sync.queue";

class SyncManager {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.secretsPath = path.join(userDataPath, "cloud_secrets.json");
    this.queuePath = path.join(userDataPath, "sync_queue.json");
    this.isProcessing = false;

    this.tokens = {
      google: null,
      microsoft: null
    };

    this.loadSecrets();
    this.loadQueue();
  }

  loadSecrets() {
    try {
      if (fs.existsSync(this.secretsPath)) {
        const raw = fs.readFileSync(this.secretsPath, "utf8");
        const parsed = JSON.parse(raw);

        // Decrypt tokens if safeStorage is available
        if (safeStorage.isEncryptionAvailable()) {
          if (parsed.google) {
            this.tokens.google = safeStorage.decryptString(Buffer.from(parsed.google, "base64"));
          }
          if (parsed.microsoft) {
            this.tokens.microsoft = safeStorage.decryptString(Buffer.from(parsed.microsoft, "base64"));
          }
        } else {
          this.tokens.google = parsed.google || null;
          this.tokens.microsoft = parsed.microsoft || null;
        }
      }
    } catch (e) {
      console.error("Failed to load secrets:", e);
    }
  }

  saveSecrets() {
    try {
      const payload = {};
      if (safeStorage.isEncryptionAvailable()) {
        if (this.tokens.google) {
          payload.google = safeStorage.encryptString(this.tokens.google).toString("base64");
        }
        if (this.tokens.microsoft) {
          payload.microsoft = safeStorage.encryptString(this.tokens.microsoft).toString("base64");
        }
      } else {
        payload.google = this.tokens.google;
        payload.microsoft = this.tokens.microsoft;
      }
      fs.writeFileSync(this.secretsPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to save secrets:", e);
    }
  }

  loadQueue() {
    try {
      if (fs.existsSync(this.queuePath)) {
        const raw = fs.readFileSync(this.queuePath, "utf8");
        this.queue = JSON.parse(raw) || [];
      } else {
        this.queue = [];
      }
    } catch (e) {
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      fs.writeFileSync(this.queuePath, JSON.stringify(this.queue, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to save queue:", e);
    }
  }

  // OAuth authentication simulation (allows users to click Link Account)
  async authenticateGoogle(parentWindow) {
    // In a real implementation, this opens an OAuth2 login window.
    // For now we will mock authentication and store a temporary token.
    this.tokens.google = "mock-google-token-" + Date.now();
    this.saveSecrets();
    return { ok: true, email: "developer@gmail.com" };
  }

  async authenticateMicrosoft(parentWindow) {
    this.tokens.microsoft = "mock-microsoft-token-" + Date.now();
    this.saveSecrets();
    return { ok: true, email: "developer@outlook.com" };
  }

  disconnectGoogle() {
    this.tokens.google = null;
    this.saveSecrets();
  }

  disconnectMicrosoft() {
    this.tokens.microsoft = null;
    this.saveSecrets();
  }

  getAuthStatus() {
    return {
      googleConnected: Boolean(this.tokens.google),
      microsoftConnected: Boolean(this.tokens.microsoft),
      googleEmail: this.tokens.google ? "developer@gmail.com" : null,
      microsoftEmail: this.tokens.microsoft ? "developer@outlook.com" : null
    };
  }

  // Add a sync task to the local queue
  enqueue(tool, action, data) {
    // Deduplicate active queue entries for the same target
    this.queue = this.queue.filter(
      (job) => !(job.tool === tool && job.data.id === data.id)
    );

    this.queue.push({
      id: "job-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6),
      tool,
      action,
      data,
      attempts: 0,
      timestamp: Date.now()
    });

    this.saveQueue();
    this.triggerSync();
  }

  // Trigger background queue processing
  async triggerSync() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    while (this.queue.length > 0) {
      const job = this.queue[0];
      try {
        await this.processJob(job);
        this.queue.shift(); // Remove completed job
        this.saveQueue();
      } catch (err) {
        console.error("Job sync failed:", err);
        job.attempts += 1;
        if (job.attempts > 3) {
          // Permanently fail after 3 retries to prevent blocking
          this.queue.shift();
          this.saveQueue();
        } else {
          // Pause queue execution on network or api issues
          break;
        }
      }
    }
    this.isProcessing = false;
  }

  async processJob(job) {
    const { tool, action, data } = job;

    // Simulated API Sync Adapters
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log(`[SyncManager] Syncing ${tool} | ${action} | ${data.title || data.id || ""}`);
        
        // Check if either cloud is connected
        if (!this.tokens.google && !this.tokens.microsoft) {
          console.log("[SyncManager] No cloud account connected, skipping external call.");
          return resolve({ ok: true, mocked: true });
        }

        // Mock syncing to external services
        if (this.tokens.google) {
          console.log(`[Google Sync] Synced ${tool} to Google Cloud services.`);
        }
        if (this.tokens.microsoft) {
          console.log(`[Microsoft Sync] Synced ${tool} to Microsoft Graph/OneDrive.`);
        }
        
        resolve({ ok: true });
      }, 500); // simulated network delay
    });
  }
}

module.exports = SyncManager;
