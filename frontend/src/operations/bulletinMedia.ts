export type BulletinMediaItem = {
  url: string;
  alt?: string;
  type: "image" | "video";
};

export function socialMosaicItems<T extends BulletinMediaItem>(media: T[]) {
  const visible = media.slice(0, 5);
  return {
    visible,
    remaining: Math.max(media.length - visible.length, 0),
  };
}
