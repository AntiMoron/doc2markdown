import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { createSign } from "crypto";
import { HandleDocFolderParams, HandleDocParams } from "../type";
import { Doc2MarkdownBase } from "../base";

export const type: HandleDocParams["type"] = "googledoc";

const HEADING_STYLE_MAP: Record<string, number> = {
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
};

const ORDERED_GLYPH_TYPES = new Set([
  "DECIMAL",
  "ZERO_DECIMAL",
  "UPPER_ALPHA",
  "ALPHA",
  "UPPER_ROMAN",
  "ROMAN",
]);

export class GoogleDocDoc2Markdown extends Doc2MarkdownBase {
  static type = type;

  constructor(protected readonly params: HandleDocParams) {
    super(params);
    if (params.type !== type) {
      throw new Error(`Invalid doc type: ${params.type}`);
    }
  }

  async getAccessToken(): Promise<{ expireTime: number; accessToken: string }> {
    const { appId: email, appSecret: privateKey } = this.params;
    if (!email || !privateKey) {
      throw new Error(
        "Google Docs requires a service account. Set appId to the service account email and appSecret to the private key from the downloaded JSON key file.",
      );
    }
    if (!email.includes("iam.gserviceaccount.com")) {
      throw new Error(
        `appId looks like an OAuth2 client ID, not a service account email. ` +
        `Service account emails end with @<project>.iam.gserviceaccount.com. ` +
        `Got: ${email}`,
      );
    }
    if (!privateKey.includes("BEGIN")) {
      throw new Error(
        `appSecret does not look like a PEM private key. ` +
        `Copy the entire "private_key" field from the service account JSON file, ` +
        `including the -----BEGIN PRIVATE KEY----- header.`,
      );
    }
    // Normalize escaped newlines that appear in JSON key files
    const pem = privateKey.replace(/\\n/g, "\n");
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/documents.readonly https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })).toString("base64url");
    const sign = createSign("RSA-SHA256");
    sign.update(`${header}.${payload}`);
    sign.end();
    const signature = sign.sign(pem, "base64url");
    const jwt = `${header}.${payload}.${signature}`;
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt },
      { headers: { "Content-Type": "application/json" } },
    );
    const accessToken: string = response.data.access_token;
    if (!accessToken) {
      throw new Error(`Google OAuth2 token exchange succeeded but returned no access_token. Response: ${JSON.stringify(response.data)}`);
    }
    return {
      accessToken,
      expireTime: Date.now() + response.data.expires_in * 1000 - 3000,
    };
  }

  private getDocumentIdFromUrl(url: string): string {
    const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error("Invalid Google Docs URL");
  }

  async getDocMetadata(
    documentId: string,
  ): Promise<{ id: string; token: string; name: string; url: string }> {
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${documentId}`,
      { headers: this.getHeaders(), params: { fields: "id,name,webViewLink" } },
    );
    const { id, name, webViewLink } = response.data;
    return { id, token: id, name, url: webViewLink };
  }

  async getRawDocContent(documentId: string): Promise<any> {
    const response = await axios.get(
      `https://docs.googleapis.com/v1/documents/${documentId}`,
      { headers: this.getHeaders() },
    );
    return response.data;
  }

  async getDocTaskList(): Promise<
    Array<{ name: string; url: string; type: string; token: string; id: string }>
  > {
    const { folderToken, docUrl } = this.params;
    let { docToken } = this.params;

    if (!docToken && docUrl) {
      docToken = this.getDocumentIdFromUrl(docUrl);
    }

    if (docToken) {
      try {
        const metadata = await this.getDocMetadata(docToken);
        return [{ ...metadata, type }];
      } catch {
        // Drive API may be unavailable (e.g. API key lacks Drive scope, or doc
        // is public via Docs API but not Drive API).  Fall back to a minimal
        // task so handleDocTask / onDocFinish can still run.
        return [{
          id: docToken,
          token: docToken,
          name: docToken,
          url: `https://docs.google.com/document/d/${docToken}/edit`,
          type,
        }];
      }
    }

    // List Google Docs files in a Drive folder
    const files: any[] = [];
    let pageToken: string | undefined;
    const pageSize = (this.params as HandleDocFolderParams).pageSize || 100;
    const maxPages = (this.params as HandleDocFolderParams).pageCount || 3;

    for (let i = 0; i < maxPages; i++) {
      const params: Record<string, string | number> = {
        q: `'${folderToken}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
        fields: "nextPageToken,files(id,name,webViewLink)",
        pageSize,
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }
      const response = await axios.get(
        "https://www.googleapis.com/drive/v3/files",
        { headers: this.getHeaders(), params },
      );
      const { files: pageFiles, nextPageToken: next } = response.data;
      files.push(...(pageFiles || []));
      if (!next) break;
      pageToken = next;
    }

    return files.map((file: any) => ({
      id: file.id,
      token: file.id,
      name: file.name,
      url: file.webViewLink,
      type,
    }));
  }

  async handleDocTask<T extends { id: string; url: string }>(
    task: T,
  ): Promise<string> {
    const doc = await this.getRawDocContent(task.id);
    return this.docToMarkdown(doc);
  }

  private async downloadGoogleImage(
    contentUri: string,
    documentId: string,
    objectId: string,
    imageMeta: Record<string, any> = {},
  ): Promise<string> {
    const { imageStorageTarget, disableImageCache } = this.params;
    let imagePath: string;

    if (typeof imageStorageTarget === "function") {
      imagePath = imageStorageTarget(contentUri, documentId, {
        objectId,
        ...imageMeta,
      });
    } else {
      const baseDir =
        typeof imageStorageTarget === "string"
          ? imageStorageTarget
          : process.cwd();
      const imagesDir = path.join(baseDir, `${documentId}_images`);
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }
      imagePath = path.join(imagesDir, `${objectId}.jpg`);
    }

    if (fs.existsSync(imagePath)) {
      if (!disableImageCache) {
        try {
          const headResp = await axios.head(contentUri, { headers: this.getHeaders() });
          const remoteSize = parseInt(headResp.headers["content-length"] ?? "0", 10);
          const localSize = fs.statSync(imagePath).size;
          if (remoteSize > 0 && remoteSize === localSize) {
            return imagePath;
          }
        } catch {
          // fall through to re-download
        }
      }
    }

    const parentDir = path.dirname(imagePath);
    fs.mkdirSync(parentDir, { recursive: true });

    const request = axios({
      url: contentUri,
      method: "GET",
      headers: this.getHeaders(),
      responseType: "stream",
    });
    const writer = fs.createWriteStream(imagePath);
    (await request).data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve as any);
      writer.on("error", reject);
    }).catch(() => {});
    return imagePath;
  }

  private async docToMarkdown(doc: any): Promise<string> {
    const { body, inlineObjects, lists, documentId } = doc;
    const content = body?.content || [];
    let result = "";

    for (const element of content) {
      if (element.paragraph) {
        result += await this.paragraphToMarkdown(
          element.paragraph,
          inlineObjects,
          lists,
          documentId,
        );
      } else if (element.table) {
        result += await this.tableToMarkdown(
          element.table,
          inlineObjects,
          lists,
          documentId,
        );
      }
      // sectionBreak and tableOfContents are intentionally skipped
    }

    return result.trim();
  }

  private getTextRunMarkdown(textRun: any): string {
    let text = textRun.content || "";
    if (text === "\n") return "\n";

    const style = textRun.textStyle || {};
    if (style.bold) {
      text = `**${text}**`;
    }
    if (style.italic) {
      text = `*${text}*`;
    }
    if (style.strikethrough) {
      text = `~~${text}~~`;
    }
    if (style.underline && !style.link) {
      // Avoid double-marking links as underline (links are inherently underlined)
      text = `++${text}++`;
    }
    if (style.link?.url) {
      text = `[${text}](${style.link.url})`;
    }
    return text;
  }

  private getInlineImageUrl(objectId: string, inlineObjects: any): string | null {
    if (!inlineObjects?.[objectId]) return null;
    const embeddedObject =
      inlineObjects[objectId].inlineObjectProperties?.embeddedObject;
    return embeddedObject?.imageProperties?.contentUri || null;
  }

  private isOrderedList(listId: string, nestingLevel: number, lists: any): boolean {
    const list = lists?.[listId];
    if (!list) return false;
    const levels: any[] = list.listProperties?.nestingLevels || [];
    const glyphType = levels[nestingLevel]?.glyphType || "";
    return ORDERED_GLYPH_TYPES.has(glyphType);
  }

  private async paragraphToMarkdown(
    paragraph: any,
    inlineObjects: any,
    lists: any,
    documentId: string,
  ): Promise<string> {
    const namedStyle = paragraph.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
    const elements = paragraph.elements || [];

    let text = "";
    for (const element of elements) {
      if (element.textRun) {
        text += this.getTextRunMarkdown(element.textRun);
      } else if (element.inlineObjectElement && !this.params.skipImages) {
        const objectId = element.inlineObjectElement.inlineObjectId;
        const contentUri = this.getInlineImageUrl(objectId, inlineObjects);
        if (contentUri) {
          const embeddedObject =
            inlineObjects[objectId]?.inlineObjectProperties?.embeddedObject;
          const size = embeddedObject?.size;
          const imageMeta: Record<string, any> = { objectId };
          if (size?.width?.magnitude) imageMeta.width = size.width.magnitude;
          if (size?.height?.magnitude) imageMeta.height = size.height.magnitude;

          const { imageStorageTarget, handleImage } = this.params;
          let imageUrl = contentUri;

          if (imageStorageTarget) {
            try {
              imageUrl = await this.downloadGoogleImage(
                contentUri,
                documentId,
                objectId,
                imageMeta,
              );
            } catch {
              // Image not accessible (e.g. 403 from service account) — keep original URL
            }
          }

          if (typeof handleImage === "function") {
            const result = handleImage(imageUrl);
            imageUrl =
              result instanceof Promise ||
              typeof (result as any).then === "function"
                ? await (result as Promise<string>)
                : (result as string);
          }

          text += `![image](${imageUrl})`;
        }
      }
    }

    // Strip trailing newline that Google includes in text runs
    text = text.replace(/\n$/, "");

    if (!text.trim()) {
      return "\n";
    }

    // Headings
    const headingLevel = HEADING_STYLE_MAP[namedStyle];
    if (headingLevel) {
      return `${"#".repeat(headingLevel)} ${text}\n`;
    }

    // List items
    const bullet = paragraph.bullet;
    if (bullet) {
      const nestingLevel = bullet.nestingLevel || 0;
      const indent = "\t".repeat(nestingLevel);
      const ordered = this.isOrderedList(bullet.listId, nestingLevel, lists);
      const prefix = ordered ? "1." : "*";
      return `${indent}${prefix} ${text}\n`;
    }

    return `${text}\n`;
  }

  private async tableToMarkdown(
    table: any,
    inlineObjects: any,
    lists: any,
    documentId: string,
  ): Promise<string> {
    const rows: any[] = table.tableRows || [];
    if (rows.length === 0) return "";

    let result = "";
    for (let i = 0; i < rows.length; i++) {
      const cells: any[] = rows[i].tableCells || [];
      const cellTexts = await Promise.all(
        cells.map(async (cell: any) => {
          const content: any[] = cell.content || [];
          const parts = await Promise.all(
            content.map(async (el: any) => {
              if (el.paragraph) {
                return (
                  await this.paragraphToMarkdown(
                    el.paragraph,
                    inlineObjects,
                    lists,
                    documentId,
                  )
                )
                  .replace(/\n$/, "")
                  .trim();
              }
              return "";
            }),
          );
          return parts.filter(Boolean).join(" ");
        }),
      );
      result += `| ${cellTexts.join(" | ")} |\n`;
      if (i === 0) {
        result += `| ${cells.map(() => "---").join(" | ")} |\n`;
      }
    }
    return result + "\n";
  }
}

export default GoogleDocDoc2Markdown;
