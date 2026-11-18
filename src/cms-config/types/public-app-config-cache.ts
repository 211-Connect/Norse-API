/**
 * A tenant's public app config as PayloadCMS writes it to Redis DB 2 under
 * `public_app_config:${tenantId}:${locale}` (Norse: `PublicAppConfig`,
 * `pushPublicAppConfigToCache`). An allowlisted subset of the AppConfig the
 * Norse website renders: branding, menus, legal page switches, alerts, i18n
 * and the map's starting view.
 */
export type PublicAppConfigMenuItem = {
  name: string;
  href?: string;
  openInNewTab?: boolean;
};

export type PublicAppConfigLegalPage = { enabled: boolean; title?: string };

export type PublicAppConfigAlert = {
  text: string;
  buttonText?: string;
  url?: string;
  target?: '_self' | '_blank';
  variant?: 'destructive' | 'default';
};

export type PublicAppConfigCache = {
  tenantId: string;
  locale: string;
  brand: {
    name: string;
    logoUrl?: string;
    faviconUrl?: string;
    openGraphUrl?: string;
    theme: {
      primaryColor?: string;
      secondaryColor?: string;
      borderRadius?: string;
    };
  };
  meta: { title: string; description: string };
  contact: { number?: string };
  header: {
    customHomeUrl?: string;
    customMenu: PublicAppConfigMenuItem[];
    feedbackUrl?: string;
  };
  footer: {
    customMenu: PublicAppConfigMenuItem[];
    copyright?: string;
    disclaimer?: string;
  };
  pages: {
    accessibilityPage: PublicAppConfigLegalPage;
    privacyPolicyPage: PublicAppConfigLegalPage;
    termsOfUsePage: PublicAppConfigLegalPage;
  };
  heroUrl?: string;
  alerts: PublicAppConfigAlert[];
  i18n: { defaultLocale: string; locales: string[] };
  newLayout?: { enabled?: boolean; headerStart?: string; headerEnd?: string };
  search: {
    /** `[longitude, latitude]`. */
    map: { center: [number, number]; zoom: number };
    defaultRadius?: number;
  };
};
