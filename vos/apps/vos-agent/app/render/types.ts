import type { Style } from "../tui/style.ts";

export type RenderSegment = Readonly<{
  text: string;
  style?: Style;
  link?: string;
}>;

export type RenderLine = Readonly<{
  segments: readonly RenderSegment[];
}>;

export type RenderedMarkdown = Readonly<{
  lines: readonly RenderLine[];
}>;

export type StylePrimitive = Readonly<{
  blockPrefix?: string;
  blockSuffix?: string;
  prefix?: string;
  suffix?: string;
  color?: Style["fg"];
  backgroundColor?: Style["bg"];
  bold?: boolean;
  italic?: boolean;
  faint?: boolean;
}>;

export type StyleBlock = StylePrimitive & Readonly<{
  indent?: number;
  indentToken?: string;
  margin?: number;
}>;

export type StyleList = StyleBlock & Readonly<{
  levelIndent?: number;
}>;

export type StyleTask = StylePrimitive & Readonly<{
  ticked?: string;
  unticked?: string;
}>;

export type StyleConfig = Readonly<{
  document?: StyleBlock;
  blockQuote?: StyleBlock;
  paragraph?: StyleBlock;
  list?: StyleList;
  heading?: StyleBlock;
  h1?: StyleBlock;
  h2?: StyleBlock;
  h3?: StyleBlock;
  h4?: StyleBlock;
  h5?: StyleBlock;
  h6?: StyleBlock;
  text?: StylePrimitive;
  strikethrough?: StylePrimitive;
  emph?: StylePrimitive;
  strong?: StylePrimitive;
  horizontalRule?: StylePrimitive;
  item?: StylePrimitive;
  enumeration?: StylePrimitive;
  task?: StyleTask;
  link?: StylePrimitive;
  linkText?: StylePrimitive;
  image?: StylePrimitive;
  imageText?: StylePrimitive;
  code?: StyleBlock;
  codeBlock?: StyleBlock;
  table?: StyleBlock;
  htmlBlock?: StyleBlock;
  htmlSpan?: StyleBlock;
}>;

export type TermRendererOptions = Readonly<{
  baseUrl?: string;
  wordWrap?: number;
  preserveNewLines?: boolean;
  inlineLinks?: boolean;
  styles?: StyleConfig;
}>;

export type TermRendererOption = (options: MutableTermRendererOptions) => void;

export type MutableTermRendererOptions = {
  baseUrl: string;
  wordWrap: number;
  preserveNewLines: boolean;
  inlineLinks: boolean;
  styles: StyleConfig;
};
