import { HandleDocParams } from "./type";

export abstract class Doc2MarkdownBase {
  static type: HandleDocParams["type"] = "none";
  private ready = false;

  private tokenData = {
    expireTime: 0,
    accessToken: "",
  };

  constructor(protected readonly params: HandleDocParams) {
    this.getCachedAccessToken().then(() => {
      this.ready = true;
    });
  }

  abstract getAccessToken(): Promise<typeof this.tokenData>;

  async getCachedAccessToken() {
    const { expireTime, accessToken: cachedAT } = this.tokenData;

    if (Date.now() < expireTime && cachedAT) {
      return { accessToken: cachedAT, expireTime };
    }
    const data = await this.getAccessToken();
    this.tokenData = { ...data };
    return {
      ...data,
    };
  }

  getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${this.tokenData.accessToken}`,
    };
  }

  abstract getDocTaskList(): Promise<
    Array<{
      name: string;
      url: string;
      type: string;
      token: string;
      id: string;
    }>
  >;

  abstract handleDocTask<T extends { id: string; url: string }>(
    task: T,
  ): Promise<string>;

  abstract getRawDocContent(documentId: string): Promise<any>;

  abstract getDocMetadata(documentId: string): Promise<any>;
}
