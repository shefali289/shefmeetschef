/* eslint-disable @next/next/no-img-element */
import type { ImgHTMLAttributes } from "react";

type MockImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  priority?: boolean;
  fill?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  quality?: number | string;
  unoptimized?: boolean;
};

/** Test double for next/image: a plain <img> so tests can read the real src and alt. */
export default function MockImage({
  src,
  priority,
  fill,
  placeholder,
  blurDataURL,
  quality,
  unoptimized,
  alt,
  ...rest
}: MockImageProps) {
  void fill;
  void placeholder;
  void blurDataURL;
  void quality;
  void unoptimized;
  return (
    <img
      src={typeof src === "string" ? src : src.src}
      alt={alt}
      data-priority={priority ? "true" : undefined}
      {...rest}
    />
  );
}
