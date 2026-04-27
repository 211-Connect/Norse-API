export type CustomAttribute = {
  source_table: string;
  source_column: string;
  link_entity: 'organization' | 'service' | 'location';
  label: {
    [locale: string]: string;
  };
  provenance: string | null;
  searchable: boolean | null;
  translate_label: boolean | null;
  translate_value: boolean | null;
  id: string | null;
};
