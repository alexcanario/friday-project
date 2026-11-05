export type PrDiff = {
  files: { path: string; changedLines: number; hasPatch: boolean }[];
  diffBytes: number;
};
