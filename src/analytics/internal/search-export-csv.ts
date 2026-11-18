import type { SearchEventExportRow } from '../dto/export-search-data-response.dto';

function escapeCSVField(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildSearchExportCSV(rows: SearchEventExportRow[]): string {
  const headers = [
    'Timestamp',
    'Session ID',
    'Query Label',
    'Query Type',
    'Search Latitude',
    'Search Longitude',
    'Search City',
    'Search ZIP Code',
    'Search County',
    'User Latitude',
    'User Longitude',
    'User City',
    'User ZIP Code',
    'User County',
    'Referral Source',
  ];

  const lines: string[] = [headers.map(escapeCSVField).join(',')];
  for (const row of rows) {
    lines.push(
      [
        escapeCSVField(row.timestamp),
        escapeCSVField(row.sessionId),
        escapeCSVField(row.queryLabel),
        escapeCSVField(row.queryType),
        escapeCSVField(row.searchLatitude),
        escapeCSVField(row.searchLongitude),
        escapeCSVField(row.searchCity),
        escapeCSVField(row.searchZipCode),
        escapeCSVField(row.searchCounty),
        escapeCSVField(row.userLatitude),
        escapeCSVField(row.userLongitude),
        escapeCSVField(row.userCity),
        escapeCSVField(row.userZipCode),
        escapeCSVField(row.userCounty),
        escapeCSVField(row.referralSource),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}
