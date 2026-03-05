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

Google Docs uses a **service account** for authentication — no browser OAuth dance required.

#### Setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **IAM & Admin → Service Accounts** → **Create Service Account**
2. Enable the **Google Docs API** and **Google Drive API** for your project
3. On the service account page → **Keys → Add Key → JSON** → download the file
4. Open the JSON file and copy `client_email` → `appId`, `private_key` → `appSecret`
5. **Share each Google Doc** with the service account email (as Viewer) — this is required

```typescript
import handleDoc from "doc2markdown";
import * as fs from "fs";
import * as path from "path";

handleDoc({
  type: "googledoc",
  appId: "my-service-account@my-project.iam.gserviceaccount.com", // client_email from JSON
  appSecret: "-----BEGIN PRIVATE KEY-----\n...",                   // private_key from JSON

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
| `appId` | `string` | Feishu: App ID. Google Docs: service account email (`client_email` from JSON key file) |
| `appSecret` | `string` | Feishu: App Secret. Google Docs: service account private key (`private_key` from JSON key file) |
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

## FAQ

### Google Docs: `403 The caller does not have permission`

You need to **share the document with your service account email**. Open the Google Doc → Share → add the service account email (e.g. `my-sa@my-project.iam.gserviceaccount.com`) as a Viewer.

### Google Docs: `appId looks like an OAuth2 client ID`

Google Docs requires a **service account**, not an OAuth2 web app client. An OAuth2 client ID looks like `...apps.googleusercontent.com`. A service account email looks like `name@project.iam.gserviceaccount.com`. Create a service account in Google Cloud Console → IAM & Admin → Service Accounts.

### Google Docs: can I use an API key instead of a service account?

No. The Google Docs API does not support API keys — it always requires credentials that identify a principal. Use a service account.

### Google Docs: images in my converted Markdown don't load

Image URLs embedded by Google in a document are authenticated and tied to the document owner's credentials. A service account typically cannot download them. Use `skipImages: true` to omit images, or implement `handleImage` to replace the URLs with your own hosted copies.

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
