export interface FetchOpts {
  accept?: string;
  timeoutMs?: number;
  /** Seconds the edge or memory cache may reuse the answer. */
  cacheTtl?: number;
}

export type FetchText = (url: string, opts?: FetchOpts) => Promise<string>;
