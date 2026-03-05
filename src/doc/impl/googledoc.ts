import axios from "axios";
import * as fs from "fs";
import * as path from "path";
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
    const { appId: clientId, appSecret: clientSecret, refreshToken } =
      this.params as HandleDocParams & { refreshToken?: string };
    if (!refreshToken) {
      throw new Error(
        "Google Docs requires a refreshToken in params",
      );
    }
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      },
      { headers: { "Content-Type": "application/json" } },
    );
    const { access_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      expireTime: Date.now() + expires_in * 1000 - 3000,
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
      {
        headers: this.getHeaders(),
        params: { fields: "id,name,webViewLink" },
      },
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
      const metadata = await this.getDocMetadata(docToken);
      return [{ ...metadata, type }];
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
    const { imageStorageTarget } = this.params;
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
      return imagePath;
    }

    const parentDir = path.dirname(imagePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

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
            imageUrl = await this.downloadGoogleImage(
              contentUri,
              documentId,
              objectId,
              imageMeta,
            );
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
