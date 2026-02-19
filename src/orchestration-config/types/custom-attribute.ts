/**
 * Custom attribute definition with localized labels
 */
export interface CustomAttribute {
  source_column: string;
  link_entity: 'organization' | 'service' | 'location';
  label: {
    [locale: string]: string;
  };
  origin: string | null;
  searchable: boolean | null;
  id: string | null;
}
