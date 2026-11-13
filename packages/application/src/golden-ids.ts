export type SeedItem = {
  id: string;
  plantedDefect: null | { kind: string; description: string };
};

export function plantedIdsOf(items: readonly SeedItem[]): string[] {
  return items.filter((item) => item.plantedDefect != null).map((item) => item.id);
}
