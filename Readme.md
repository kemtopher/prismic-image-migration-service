# Prismic Migration Script  
### Move Inline RichText Image → `featured_image`

## Overview

This is a one-off migration script that moves the single image stored in the `content` RichText field of each `post` document into a proper Image field called:


Original image post structure:

```js
data.content = [
  {
    type: "image",
    id: "...",
    url: "...",
    dimensions: { width, height }
  }
]
```

#This script normalizes that so:
image = featured_image
content = body content (cleared)
Images are structured instead of embedded in RichText

#What The Script Does
For each post document:
Skips if featured_image already exists
Checks that content[0] is an image block
Copies image data into featured_image
Optionally clears content
Writes the updated document to a Migration Release

#It includes:
Rate-limit protection
Retry logic
Throttling between requests
Dry-run mode


##Environment Variables

PRISMIC_REPOSITORY="your-repo-name"
PRISMIC_CONTENT_API_TOKEN="..."      # Read token
PRISMIC_WRITE_API_TOKEN="..."        # Write token
PRISMIC_MIGRATION_API_KEY="..."      # Migration Release key

DRY_RUN="1"                          # 1 = dry run (safe)
CLEAR_RICHTEXT_IMAGE="1"             # 1 = remove inline image
THROTTLE_MS="350"
MAX_RETRIES="8"

##Where To Find These
Repository name → Prismic dashboard
API tokens → Settings → API & Security
Migration key → Migration Release screen

##Install Dependencies
npm install @prismicio/client axios dotenv

##Running The Script
#1. Dry Run (Safe Mode)
This does NOT modify Prismic repo.
DRY_RUN=1 node index.mjs

#2. Live Mode (Writes to Migration Release Only)
DRY_RUN=0 node index.mjs

##After running:
Prismic Dashboard → Migrations → Your Migration Release
Review the changes.
Then manually click Publish Release when ready.