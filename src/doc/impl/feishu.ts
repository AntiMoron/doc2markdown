import axios from "axios";
import { HandleDocFolderParams, HandleDocParams } from "../type";
import * as fs from "fs";
import * as path from "path";
import { Doc2MarkdownBase } from "../base";

export const type: HandleDocParams["type"] = "feishu";

// https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-structure
export enum FeishuBlockType {
  Page           = 1,
  Text           = 2,
  Heading1       = 3,
  Heading2       = 4,
  Heading3       = 5,
  Heading4       = 6,
  Heading5       = 7,
  Heading6       = 8,
  Heading7       = 9,
  Heading8       = 10,
  Heading9       = 11,
  Bullet         = 12,
  Ordered        = 13,
  Code           = 14,
  Quote          = 15,
  Equation       = 16,
  Todo           = 17,
  Bitable        = 18,
  Callout        = 19,
  ChatCard       = 20,
  Diagram        = 21,
  Divider        = 22,
  File           = 23,
  Grid           = 24,
  GridColumn     = 25,
  Iframe         = 26,
  Image          = 27,
  ISV            = 28,
  Mindnote       = 29,
  Sheet          = 30,
  Table          = 31,
  TableCell      = 32,
  View           = 33,
  QuoteContainer = 34,
  Task           = 35,
  OKR            = 36,
  OKRObjective   = 37,
  OKRKeyResult   = 38,
  OKRProgress    = 39,
  AddOns         = 40,
  JiraIssue      = 41,
  WikiCatalog    = 42,
  Board          = 43,
  Undefined      = 999,
}

interface ImageContentType {
  align: number;
  height: number;
  scale: number;
  token: string;
  width: number;
}

interface BlockContentType {
  elements: Array<{
    text_run: {
      content: string;
      text_element_style: {
        bold: boolean;
        inline_code: boolean;
        italic: boolean;
        strikethrough: boolean;
        underline: boolean;
      };
    };
  }>;
}

interface BlockType {
  block_id: string;
  block_type: number;
  children?: string[];
  table: {
    cells: string[];
    property: {
      column_size: number;
      row_size: number;
      header_row: boolean;
      merge_info: Array<{
        col_span: number;
        row_span: number;
      }>;
    };
  };
  bullet?: BlockContentType & { style: { align: number } }; // 12
  ordered?: BlockContentType & { style: { align: number; sequence: string } }; // 13
  image?: ImageContentType;
  text?: BlockContentType;
  heading1?: BlockContentType;
  heading2?: BlockContentType;
  heading3?: BlockContentType;
  heading4?: BlockContentType;
  heading5?: BlockContentType;
  parent_id: string;
}

export class FeishuDoc2Markdown extends Doc2MarkdownBase {
  static type = type;

  constructor(protected readonly params: HandleDocParams) {
    super(params);
    if (params.type !== type) {
      throw new Error(`Invalid doc type: ${params.type}`);
    }
  }

  async getAccessToken(): Promise<{ expireTime: number; accessToken: string }> {
    /**
     * 获取飞书访问令牌
     * @doc https://open.feishu.cn/document/faq/trouble-shooting/how-to-choose-which-type-of-token-to-use
     * @param appId
     * @param appSecret
     */
    const apiUrl =
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
    const { appId, appSecret } = this.params;
    const data = await axios.post(
      apiUrl,
      {
        app_id: appId,
        app_secret: appSecret,
      },
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
    const { tenant_access_token: accessToken, code, msg, expire } = data.data;
    if (code !== 0) {
      throw new Error(`Failed to get Feishu access token: ${msg}`);
    }
    return {
      expireTime: Date.now() + expire * 1000 - 3000, // Milliseconds
      accessToken,
    };
  }

  async handleDocTask<T extends { id: string; url: string }>(
    task: T,
  ): Promise<string> {
    const { id: docId, url: docUrl, ...metadata } = task;
    const data = await this.getRawDocContent(docId);
    const { items } = data;
    const result = await this.blockToMarkdown(
      docId,
      items[0],
      items.reduce((pre: any, obj: any) => {
        pre[obj.block_id] = obj;
        return pre;
      }, {}),
      0,
      0,
    );
    return result;
  }

  private getDocumentIdFromUrl(url: string) {
    const match = url.match(/docx\/([a-zA-Z0-9]+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error("Invalid Feishu document URL");
  }

  async getDocMetadata(
    documentId: string,
  ): Promise<{ id: string; token: string; name: string }> {
    const api = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`;
    const data = await axios.get(api, {
      headers: this.getHeaders(),
    });
    const metadata = data.data?.data?.document;
    return {
      ...metadata,
      id: metadata.document_id,
      token: metadata.document_id,
      url: metadata.url,
      name: metadata.title,
    };
  }

  async getRawDocContent(documentId: string): Promise<any> {
    // Impl
    const apiUrl = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`;
    const data = await axios.get(apiUrl, {
      headers: this.getHeaders(),
    });
    return data.data?.data;
  }

  private async handleFeishuImage(
    documentId: string,
    resourceToken: string,
    imageMeta: Record<string, any> = {},
  ) {
    const { imageStorageTarget, disableImageCache, skipMediaCheck } = this.params;
    const downloadUrl = `https://open.feishu.cn/open-apis/drive/v1/medias/${resourceToken}/download`;
    let imagePath: string;

    if (typeof imageStorageTarget === "function") {
      imagePath = imageStorageTarget(downloadUrl, documentId, {
        token: resourceToken,
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
      imagePath = path.join(imagesDir, `${resourceToken}.jpg`);
    }

    if (fs.existsSync(imagePath)) {
      if (skipMediaCheck) {
        return imagePath;
      }
      if (!disableImageCache) {
        try {
          const headResp = await axios.head(downloadUrl, { headers: this.getHeaders() });
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
      url: downloadUrl,
      method: "GET",
      headers: this.getHeaders(),
      responseType: "stream",
    });
    const writer = fs.createWriteStream(imagePath);
    (await request).data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve as any);
      writer.on("error", reject);
    }).catch((err) => {});
    return imagePath;
  }

  private getDefaultSequenceForDepth(depth: number) {
    switch (depth) {
      case 0:
      case 1:
        return "1";
      case 2:
        return "a";
      case 3:
        return "i";
      default:
        return "1";
    }
  }

  private getContentFromTextBlock(property: BlockContentType) {
    let str = "";
    let content = "";
    const style = property.elements[0].text_run.text_element_style;
    const { bold, inline_code, italic, strikethrough, underline } = style;
    content = property.elements[0].text_run.content;
    const composedContent = [content];
    if (bold) {
      composedContent.push("**");
      composedContent.unshift("**");
    }
    if (inline_code) {
      composedContent.push("`");
      composedContent.unshift("`");
    }
    if (italic) {
      composedContent.push("*");
      composedContent.unshift("*");
    }
    if (strikethrough) {
      composedContent.push("~~");
      composedContent.unshift("~~");
    }
    if (underline) {
      composedContent.push("++");
      composedContent.unshift("++");
    }
    str += composedContent.join("");
    return str;
  }

  calcOrderedSequence(depth: number, currentSequence: string, dist: number) {
    let tryNum = Number(currentSequence);
    if (tryNum === tryNum) {
      // is not NaN
      return `${tryNum + dist}`;
    }

    if (/^[a-zA-Z]+$/.test(currentSequence)) {
      const isUpperCase = /^[A-Z]+$/.test(currentSequence);
      const lowerSymbol = currentSequence.toLowerCase();
      const upperSymbol = currentSequence.toUpperCase();
      // 3. 字母字符串转十进制数值（a=1, b=2...z=26）
      let num = 0;
      for (let char of lowerSymbol) {
        const charCode = char.charCodeAt(0) - "a".charCodeAt(0) + 1; // 转换为1-26的数值
        num = num * 26 + charCode;
      }

      // 4. 加上增量
      num += dist;

      // 5. 十进制数值转回字母字符串（26进制，无0）
      let newSymbol = "";
      while (num > 0) {
        let remainder = num % 26;
        // 余数为0时，对应z（因为26%26=0，实际是z）
        if (remainder === 0) {
          remainder = 26;
          num = Math.floor(num / 26) - 1; // 进位减1
        } else {
          num = Math.floor(num / 26);
        }
        // 转换为字母（小写）
        newSymbol =
          String.fromCharCode(remainder - 1 + "a".charCodeAt(0)) + newSymbol;
      }

      // 6. 还原大小写
      return isUpperCase ? newSymbol.toUpperCase() : newSymbol;
    }
    return this.getDefaultSequenceForDepth(depth);
  }

  async blockToMarkdown(
    documentId: string,
    block: BlockType,
    blockMap: Record<string, BlockType>,
    depth: number, // start from 0
    siblingOrder: number,
  ): Promise<string> {
    let str = "";
    let content = "";
    const { handleImage, skipImages } = this.params;
    const {
      block_id: blockId,
      parent_id: parentId,
      block_type,
      children,
      ordered,
      bullet,
    } = block;
    let { table } = block;
    switch (block_type) {
      case FeishuBlockType.Page:
        break;
      case FeishuBlockType.Text:
        const property = block.text as BlockContentType;
        str += this.getContentFromTextBlock(property);
        break;
      case FeishuBlockType.Heading1:
        break;
      case FeishuBlockType.Heading2:
        const properKeys = [1, 2, 3, 4, 5].map((a) => `heading${a}`);
        for (let i = 0; i < properKeys.length; i++) {
          const k = properKeys[i];
          const property = block[k as keyof BlockType] as BlockContentType;
          if (!property) {
            continue;
          }
          content = property.elements[0].text_run.content;
          for (let j = 0; j < i + 1; j++) {
            str += "#";
          }
          str += ` ${content}\n`;
          break;
        }
        break;
      case FeishuBlockType.Image:
        const image = block.image;
        if (image && !skipImages) {
          const { token, scale, width, height } = image;
          let imageUrl = token;
          await this.getCachedAccessToken();
          imageUrl = await this.handleFeishuImage(documentId, token, { scale, width, height });
          if (typeof handleImage === "function") {
            const d = handleImage(imageUrl);
            if (d instanceof Promise || typeof (d as any).then === "function") {
              imageUrl = await (d as Promise<string>);
            } else {
              imageUrl = d as string;
            }
          }
          str += `![image](${imageUrl})`;
        }
        break;
      case FeishuBlockType.Grid:
        break;
      case FeishuBlockType.Table:
      case FeishuBlockType.TableCell:
        break;
      case FeishuBlockType.QuoteContainer:
        str += "> ";
        break;
      case FeishuBlockType.Callout:
        break;
      default:
        break;
    }
    // columns -> table with 1row, N cols.
    if (block_type === FeishuBlockType.Grid) {
      table = {
        cells: children ? [...children] : [],
        property: {
          column_size: children ? children.length : 0,
          row_size: 1,
          header_row: false,
          merge_info: [],
        },
      };
    }
    if (block_type === FeishuBlockType.Bullet && bullet) {
      for (let a = 0; a < depth - 1; a++) {
        str += "\t";
      }
      str += "* " + this.getContentFromTextBlock(bullet);
    } else if (block_type === FeishuBlockType.Ordered && ordered) {
      const sequence = ordered.style.sequence;
      const align = ordered.style.align;
      let seq = `${sequence}. `;
      if (sequence === "auto") {
        const siblingIds = blockMap[parentId].children || [];
        const idx = siblingIds.findIndex((item) => item === blockId);
        if (idx < 0) {
          seq = this.getDefaultSequenceForDepth(depth) + ". ";
        } else {
          // check what last item is.
          const brotherIds = siblingIds.slice(0, idx);
          let dist = 1;
          const headingBrotherIndex =
            brotherIds.length -
            brotherIds.reverse().findIndex((item) => {
              const block = blockMap[item];
              if (block && block.ordered && block.ordered.style) {
                if (block.ordered.style.sequence === "auto") {
                  dist += 1;
                } else {
                  return true;
                }
              }
              return false;
            }) -
            1;
          const brother = blockMap[siblingIds[headingBrotherIndex]];
          if (
            brother?.ordered?.style?.sequence &&
            brother?.ordered?.style?.sequence !== "auto"
          ) {
            seq =
              this.calcOrderedSequence(
                depth,
                brother.ordered.style.sequence,
                dist,
              ) + ". ";
          } else {
            seq = this.getDefaultSequenceForDepth(depth) + ". ";
          }
        }
      }
      for (let a = 0; a < depth - 1; a++) {
        str += "\t";
      }
      str += seq + this.getContentFromTextBlock(ordered);
    }
    if (
      (block_type === FeishuBlockType.Bullet || block_type === FeishuBlockType.Ordered) &&
      children &&
      children.length > 0
    ) {
      str += "\n";
    }
    // --- split --- //
    if (table && table.property) {
      const tableProps = table.property;
      const { cells } = table;
      const { column_size, row_size } = tableProps;
      let tbStr = "";
      let cellIndex = 0;
      for (let j = 0; j < row_size; j++) {
        if (column_size === 0) {
          continue;
        }
        for (let i = 0; i < column_size; i++) {
          const cellBlock = blockMap[cells[cellIndex]];
          if (!cellBlock) {
            if (i === 0) {
              tbStr += "| ";
            }
            tbStr += i === column_size - 1 ? " |\n" : " | ";
            cellIndex += 1;
            continue;
          }
          if (i === 0) {
            tbStr += "| ";
          }

          tbStr += await this.blockToMarkdown(
            documentId,
            cellBlock,
            blockMap,
            0,
            0,
          );
          tbStr += i === column_size - 1 ? " |\n" : " | ";

          cellIndex += 1;
        }
        if (j === 0) {
          for (let i = 0; i < column_size; i++) {
            tbStr += "|---";
          }
          tbStr += "|\n";
        }
      }
      str += tbStr;
    } else if (children && children.length > 0) {
      for (let j = 0; j < children.length; j++) {
        const childId = children[j];
        str += await this.blockToMarkdown(
          documentId,
          blockMap[childId],
          blockMap,
          depth + 1,
          j,
        );
        if (block_type === FeishuBlockType.GridColumn) {
          str += "<br>";
        } else if (
          block_type !== FeishuBlockType.TableCell &&
          block_type !== FeishuBlockType.QuoteContainer &&
          j !== children.length - 1
        ) {
          str += "\n";
        }
      }
    }
    // ------dont remove--------split-------//
    if (block_type === FeishuBlockType.Callout) {
      str = str
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    return str;
  }

  private async getFileList(folderToken: string, nextPageToken?: string) {
    await this.getCachedAccessToken();
    const params: Record<string, string | number> = {
      folder_token: folderToken,
      page_size: (this.params as HandleDocFolderParams).pageSize || 200,
    };
    if (nextPageToken) {
      params["page_token"] = nextPageToken;
    }
    const api = "https://open.feishu.cn/open-apis/drive/v1/files";
    const request = await axios.get(api, {
      headers: this.getHeaders(),
      params,
    });
    return request.data?.data;
  }

  async getDocTaskList(): Promise<
    Array<{
      name: string;
      url: string;
      type: string;
      token: string;
      id: string;
    }>
  > {
    const { folderToken, docUrl } = this.params;
    let { docToken } = this.params;
    if (!docToken && docUrl) {
      docToken = this.getDocumentIdFromUrl(docUrl);
    }
    if (docToken) {
      const singleData = await this.getDocMetadata(docToken);
      return [
        {
          ...singleData,
          url: docUrl ?? "",
          type: "docx",
        },
      ];
    }

    let files: any[] = [];
    let nextPageToken: string | undefined = undefined;
    const maxIterations = (this.params as HandleDocFolderParams).pageCount || 3;
    for (let i = 0; i < maxIterations; i++) {
      const requestData = await this.getFileList(folderToken!, nextPageToken);
      files = files.concat(requestData?.files || []);
      const { has_more: hasMore, next_page_token: newNextPageToken } =
        requestData;
      nextPageToken = newNextPageToken;
      if (!hasMore) {
        break;
      }
    }
    return files.map((item: any) => {
      return {
        ...item,
        id: item.token,
      };
    });
  }
}

export default FeishuDoc2Markdown;
