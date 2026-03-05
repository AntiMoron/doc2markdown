# doc2markdown

**Convert Feishu (飞书) and Google Docs documents to Markdown — automatically.**

> Feishu to Markdown · Google Docs to Markdown · 飞书转Markdown · 飞书文档转MD

**Keywords:** feishu to markdown, feishu doc to markdown, 飞书转markdown, 飞书文档转markdown, google docs to markdown, google doc to markdown, doc2markdown, docx to markdown, nodejs, typescript

---

## Why doc2markdown?

Most knowledge lives in Feishu docs or Google Docs. Getting that content into Markdown — for static sites, RAG pipelines, LLM context, or version-controlled wikis — is painful to do by hand. `doc2markdown` automates the whole thing: authenticate once, point at a doc or folder, get clean Markdown out.

## Features

- **Feishu (飞书) → Markdown** — batch-convert an entire Feishu folder or a single doc via `appId` / `appSecret`
- **Google Docs → Markdown** — convert Google Docs via OAuth2 credentials or a simple API key (for public docs)
- Image download with configurable storage target (`imageStorageTarget`), with automatic recursive directory creation
- Image cache: by default, downloaded images are verified by comparing remote `content-length` to local file size — re-download is skipped when they match. Disable with `disableImageCache: true`
- Skip the remote media check entirely with `skipMediaCheck: true` — if the local file exists it is returned without any HEAD request
- Skip images entirely with `skipImages: true` for faster text-only runs
- Post-process every image URL with a `handleImage` callback (e.g. re-upload to your CDN)
- Progress callbacks and per-doc finish hooks
- AI/RAG-friendly: use a Feishu or Google Drive folder as a knowledge base

## Supported Platforms

| Platform       | Status |
|----------------|--------|
| Feishu (飞书)  | ✅     |
| Google Docs    | ✅     |
| Dingtalk Doc   | planned |

---

## Installation

```bash
npm install doc2markdown
# or
yarn add doc2markdown
```

---

## Usage

### Feishu (飞书) → Markdown

1. Create a Feishu internal app at https://open.feishu.cn/
2. Grant the app these permissions:
   - `docx:document:readonly`
   - `drive:drive`
   - `space:document:retrieve`

```typescript
import handleDoc from "doc2markdown";
import * as fs from "fs";
import * as path from "path";

handleDoc({
  type: "feishu",
  appId: "YOUR_APP_ID",
  appSecret: "YOUR_APP_SECRET",

  // Single doc by URL:
  docUrl: "https://yourcompany.feishu.cn/docx/XXXXXX",
  // Or an entire folder:
  // folderToken: "YOUR_FOLDER_TOKEN",

  handleProgress: (done, errors, total) => {
    console.log(`${done}/${total} done, ${errors} errors`);
  },
  onDocFinish: (docId, markdown) => {
    fs.writeFileSync(path.resolve(process.cwd(), `${docId}.md`), markdown);
  },
});
```

### Google Docs → Markdown

Two authentication modes are supported:

#### Option A: API Key (public docs — simplest)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**
2. Create an **API Key**
3. Enable the **Google Docs API** and **Google Drive API** for your project
4. Make sure the document is shared as "Anyone with the link can view"

```typescript
import handleDoc from "doc2markdown";
import * as fs from "fs";
import * as path from "path";

handleDoc({
  type: "googledoc",
  apiKey: "YOUR_GOOGLE_API_KEY",

  // Single doc by URL:
  docUrl: "https://docs.google.com/document/d/XXXXXX/edit",

  onDocFinish: (docId, markdown) => {
    fs.writeFileSync(path.resolve(process.cwd(), `${docId}.md`), markdown);
  },
});
```

> **Note:** API keys only work for publicly shared documents. For private docs use OAuth2 below. Inline image download also requires OAuth2; use `skipImages: true` with API key mode.

#### Option B: OAuth2 (private docs)

1. Create an OAuth2 client in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Docs API** and **Google Drive API**
3. Obtain a refresh token (e.g. via the OAuth2 Playground)

```typescript
import handleDoc from "doc2markdown";
import * as fs from "fs";
import * as path from "path";

handleDoc({
  type: "googledoc",
  appId: "YOUR_OAUTH_CLIENT_ID",
  appSecret: "YOUR_OAUTH_CLIENT_SECRET",
  refreshToken: "YOUR_REFRESH_TOKEN",

  // Single doc by URL:
  docUrl: "https://docs.google.com/document/d/XXXXXX/edit",
  // Or an entire Drive folder:
  // folderToken: "YOUR_DRIVE_FOLDER_ID",

  handleProgress: (done, errors, total) => {
    console.log(`${done}/${total} done, ${errors} errors`);
  },
  onDocFinish: (docId, markdown) => {
    fs.writeFileSync(path.resolve(process.cwd(), `${docId}.md`), markdown);
  },
});
```

### Get the document task list

```typescript
import { getDocTaskList } from "doc2markdown";

getDocTaskList({
  type: "feishu", // or "googledoc"
  appId: "...",
  appSecret: "...",
  docUrl: "https://yourcompany.feishu.cn/docx/XXXXXX",
}).then(tasks => console.log(tasks));
```

---

## Options

| Option | Type | Description |
|---|---|---|
| `type` | `"feishu" \| "googledoc"` | Document platform |
| `appId` | `string` | Feishu App ID or Google OAuth client ID |
| `appSecret` | `string` | Feishu App Secret or Google OAuth client secret |
| `apiKey` | `string` | Google API key for public Google Docs (no OAuth2 needed) |
| `refreshToken` | `string` | Google OAuth refresh token (Google Docs OAuth2 only) |
| `docUrl` | `string` | URL of a single document |
| `docToken` | `string` | Document token / ID (alternative to `docUrl`) |
| `folderToken` | `string` | Folder token / Drive folder ID for batch processing |
| `skipImages` | `boolean` | Skip all images (faster text-only conversion) |
| `imageStorageTarget` | `string \| (url, docId, meta) => string` | Directory path or function returning the full file path for downloaded images. Intermediate directories are created automatically. |
| `disableImageCache` | `boolean` | When `false` (default), skips re-downloading an image if the local file size matches the remote `content-length`. Set to `true` to always re-download. |
| `skipMediaCheck` | `boolean` | When `true`, skips the remote `content-length` check entirely — if the local file already exists it is returned immediately without making a HEAD request. |
| `handleImage` | `(localPath) => string \| Promise<string>` | Transform the local image path before embedding in Markdown (e.g. upload to CDN) |
| `handleProgress` | `(done, errors, total) => void` | Progress callback |
| `onDocFinish` | `(docId, markdown, metadata?) => void` | Called when each document finishes |
| `shouldHandleUrl` | `(url) => Promise<boolean>` | Filter which documents to process |

---

## Roadmap

PRs welcome — if you find this useful, come contribute instead of just starring it.

| Platform       | Status  |
|----------------|---------|
| Feishu (飞书)  | ✅ done |
| Google Docs    | ✅ done |
| Dingtalk Doc   | planned |

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AntiMoron/feishu2markdown&type=Date)](https://star-history.com/#AntiMoron/feishu2markdown&Date)

---

## Contributors

Thanks to everyone who has contributed to this project!

[![Contributors](https://contrib.rocks/image?repo=AntiMoron/feishu2markdown)](https://github.com/AntiMoron/feishu2markdown/graphs/contributors)
