/**
 * Parameters for handling documents from different platforms.
 */
export interface HandleDocBaseParams {
  type: "feishu" | "googledoc" | "none";

  /**
   * Optional base URL for API requests, useful for self-hosted or proxy setups.
   * @description currently only supported for Feishu; Google Docs API has a fixed endpoint and does not support custom base URLs.
   */
  baseUrl?: string;
  /**
   * For Feishu: App ID.
   * For Google Docs: service account email (the `client_email` field from the downloaded JSON key file).
   */
  appId?: string;
  /**
   * For Feishu: App Secret.
   * For Google Docs: service account private key (the `private_key` field from the downloaded JSON key file).
   */
  appSecret?: string;
  shouldHandleUrl?: (url: string) => Promise<boolean>;
  handleImage?: (imageUrl: string) => string | Promise<string>;
  /**
   * Determines where downloaded images are stored.
   * - string: base directory; images are saved as `{dir}/{docId}_images/{filename}`
   * - function: receives (originalUrl, docId, metaInfo) and returns the full target file path
   * Defaults to process.cwd() when not set.
   */
  imageStorageTarget?: string | ((url: string, docId: string, metaInfo: Record<string, any>) => string);
  skipImages?: boolean;
  /**
   * When false (default), before downloading an image the remote content-length is compared
   * to the local file size; if they match the download is skipped.
   * Set to true to always re-download images regardless of local state.
   */
  disableImageCache?: boolean;
  /**
   * When true, skips the remote content-length check entirely.
   * If the local file already exists it is returned as-is without making a HEAD request.
   */
  skipMediaCheck?: boolean;
  handleProgress?: (
    doneCount: number,
    errorCount: number,
    allCount: number,
  ) => void;
  onDocFinish?: (
    docId: string,
    markdown: string,
    metadata?: any,
  ) => void | Promise<void>;
  folderToken?: string;
  docUrl?: string;
  docToken?: string;
}

/**
 * Parameters for handling documents from different platforms.
 */
export interface HandleDocFolderParams extends HandleDocBaseParams {
  folderToken: string;
  /**
   * By default 200
   */
  pageSize?: number;

  /**
   * Times of iteration
   */
  pageCount?: number;
}

export interface HandleDocUrlParams extends HandleDocBaseParams {
  docUrl: string;
}

export interface HandleDocTokenParams extends HandleDocBaseParams {
  docToken: string;
}

/**
 * Parameters for handling documents from different platforms.
 */
export type HandleDocParams = HandleDocFolderParams | HandleDocUrlParams | HandleDocTokenParams;
