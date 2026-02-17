import { CustomAttribute } from './custom-attribute';

export type CustomAttributeCsvRow = Pick<
  CustomAttribute,
  'source_column' | 'link_entity' | 'provenance'
> & {
  label: string;
};
