/**
 * Custom attribute definition with localized labels
 */
export interface CustomAttribute {
  source_column: string;
  link_entity: 'organization' | 'service' | 'location';
  label: {
    [locale: string]: string;
  };
  provenance: string | null;
  searchable: boolean | null;
  id: string | null;
}
