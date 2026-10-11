declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SERVICE_SIGNING_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
