#!/usr/bin/env node
import "dotenv/config";
import axios from "axios";
import * as prismic from "@prismicio/client";

const {
  PRISMIC_REPOSITORY,
  PRISMIC_CONTENT_API_TOKEN,
  PRISMIC_WRITE_API_TOKEN,
  PRISMIC_MIGRATION_API_KEY,
  DRY_RUN = "1",
  CLEAR_RICHTEXT_IMAGE = "1",
  PRISMIC_MIGRATION_API_BASE_URL = "https://migration.prismic.io",
  // Optional knobs
  THROTTLE_MS = "350",
  MAX_RETRIES = "8",
} = process.env;

if (!PRISMIC_REPOSITORY) throw new Error("Missing PRISMIC_REPOSITORY");
if (!PRISMIC_WRITE_API_TOKEN) throw new Error("Missing PRISMIC_WRITE_API_TOKEN");
if (!PRISMIC_MIGRATION_API_KEY) throw new Error("Missing PRISMIC_MIGRATION_API_KEY");

if (!PRISMIC_CONTENT_API_TOKEN) {
  console.warn(
    "PRISMIC_CONTENT_API_TOKEN is missing. Reads may fail if your Prismic repo is private."
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Document API (read)
const documentApiUrl = `https://${PRISMIC_REPOSITORY}.cdn.prismic.io/api/v2`;
const documentClient = prismic.createClient(documentApiUrl, {
  accessToken: PRISMIC_CONTENT_API_TOKEN,
});

// Migration API (write)
const migrationClient = axios.create({
  baseURL: PRISMIC_MIGRATION_API_BASE_URL,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Repository: PRISMIC_REPOSITORY,
    Authorization: `Bearer ${PRISMIC_WRITE_API_TOKEN}`,
    "X-Api-Key": PRISMIC_MIGRATION_API_KEY,
  },
});

// Helper: map rich text image block → image field value
function mapRichTextImageToImageField(imgBlock) {
  return {
    id: imgBlock.id,
    url: imgBlock.url,
    dimensions: imgBlock.dimensions,
    alt: imgBlock.alt ?? null,
    copyright: imgBlock.copyright ?? null,
    edit: imgBlock.edit ?? null,
  };
}

async function putWithRetry(url, payload, { maxRetries = 8 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await migrationClient.put(url, payload);
    } catch (err) {
      const status = err?.response?.status;

      // Retry on rate-limit + common transient upstream errors
      const shouldRetry =
        status === 429 || status === 502 || status === 503 || status === 504;

      if (!shouldRetry || attempt >= maxRetries) {
        throw err;
      }

      // Respect Retry-After if present (seconds). Otherwise exponential backoff + jitter.
      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : null;

      const backoffMs = retryAfterMs ?? Math.min(30_000, 500 * 2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 250);
      const waitMs = backoffMs + jitterMs;

      console.warn(
        `Rate limited / transient error (status ${status}). Retry ${attempt + 1}/${maxRetries} in ${waitMs}ms...`
      );

      await sleep(waitMs);
      attempt++;
    }
  }
}

async function main() {
  const posts = await documentClient.getAllByType("post");
  console.log(`Found ${posts.length} post docs`);

  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;

  const throttleMs = Number(THROTTLE_MS);
  const maxRetries = Number(MAX_RETRIES);

  for (const doc of posts) {
    const data = doc.data ?? {};
    const content = Array.isArray(data.content) ? data.content : [];

    // Already has a featured image? skip.
    if (data.featured_image?.url) {
      skipped++;
      continue;
    }

    const img0 = content[0];

    // Require id/url since your rich text image block always has them
    if (!img0 || img0.type !== "image" || !img0.url || !img0.id) {
      skipped++;
      continue;
    }

    const nextData = {
      ...data,
      featured_image: mapRichTextImageToImageField(img0),
      content: CLEAR_RICHTEXT_IMAGE === "1" ? [] : content,
    };

    const payload = {
      id: doc.id,
      title: doc.title ?? doc.uid ?? doc.id,
      type: doc.type,
      lang: doc.lang,
      uid: doc.uid,
      alternate_language_id: doc.alternate_language_id,
      data: nextData,
    };

    if (DRY_RUN === "1") {
      console.log(`[DRY RUN] Would update ${doc.id} (${doc.uid ?? "no-uid"})`);
      wouldUpdate++;
      continue;
    }

    await putWithRetry(`/documents/${doc.id}`, payload, { maxRetries });
    console.log(`Updated ${doc.id} (${doc.uid ?? "no-uid"})`);
    updated++;

    // Steady throttle to reduce rate-limits
    if (Number.isFinite(throttleMs) && throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  if (DRY_RUN === "1") {
    console.log(`Done (dry run). Would update: ${wouldUpdate}, Skipped: ${skipped}`);
  } else {
    console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
  }
}

main().catch((err) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
