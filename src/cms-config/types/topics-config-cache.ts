export type TopicSubtopicCache = {
  id?: string;
  name: string;
  names: Record<string, string>;
  queryType?: string;
  query?: string;
  href?: string;
  target?: string;
};

export type TopicCache = {
  id?: string;
  name: string;
  names: Record<string, string>;
  image?: string;
  href?: string;
  target?: string;
  subtopics: TopicSubtopicCache[];
};

export type TopicsConfigCache = {
  tenantId: string;
  iconSize: string;
  imageBorderRadius: string;
  backText?: string;
  backTexts: Record<string, string>;
  customHeading?: string;
  customHeadings: Record<string, string>;
  list: TopicCache[];
};
