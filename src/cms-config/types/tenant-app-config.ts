/**
 * The part of a tenant's Payload AppConfig (`GET /api/tenants/:id/config`)
 * that Norse-API passes on: branding colors, the map's starting view, the
 * default search radius and the active alerts. Field names and nesting follow
 * Payload's AppConfig so clients can read either.
 */
export type TenantAppConfigTheme = {
  primaryColor?: string;
  secondaryColor?: string;
  borderRadius?: string;
};

export type TenantAppConfigAlert = {
  text: string;
  buttonText?: string;
  url?: string;
  target?: string;
  variant?: string;
};

export type TenantAppConfig = {
  tenantId: string;
  brand: { theme: TenantAppConfigTheme };
  search: {
    map: {
      /** `[longitude, latitude]`; null when Payload has no usable center. */
      center: [number, number] | null;
      zoom?: number;
    };
    defaultRadius?: number;
  };
  /** Payload returns only the alerts that are active now. */
  alerts: TenantAppConfigAlert[];
};
