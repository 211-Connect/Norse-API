import { Locale } from 'src/common/types/locale';

export type CustomAttribute = {
  source_column: string;
  link_entity: string;
  label: Record<Locale, string>;
  provenance: string | null;
  searchable: boolean | null;
  id: string | null;
};
