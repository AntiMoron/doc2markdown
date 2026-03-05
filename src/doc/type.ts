/**
 * Parameters for handling documents from different platforms.
 */
export interface HandleDocBaseParams {
  type: "feishu" | "googledoc" | "none";
  appId: string;
  appSecret: string;
  refreshToken?: string;
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
