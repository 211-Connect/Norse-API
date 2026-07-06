/**
 * Shared Swagger examples for Resource endpoints
 */

export const RESOURCE_EXAMPLE = {
  _id: '00000000-0000-0000-0000-000000000000',
  location: {
    type: 'Point',
    coordinates: [-106.0746, 42.1485],
  },
  addresses: [
    {
      city: 'Example',
      country: 'United States',
      address_1: '543 East Connect Street',
      postalCode: '99032',
      stateProvince: 'WA',
      rank: 1,
      type: 'physical',
    },
  ],
  attribution: 'Connect 211',
  createdAt: '2024-08-26T00:00:00',
  displayName: 'FINANCIAL AND FOOD ASSISTANCE | EXAMPLE ORGANIZATION',
  displayPhoneNumber: '(555) 555-5555',
  email: 'info@example.com',
  languages: ['English', 'Spanish'],
  lastAssuredDate: '2024-08-26T00:00:00',
  organizationName: 'EXAMPLE ORGANIZATION',
  phoneNumbers: [
    {
      number: '(555) 555-5555',
      rank: 1,
      type: 'voice',
    },
    {
      number: '(555) 555-5555',
      rank: 2,
      type: 'fax',
    },
  ],
  serviceArea: {
    type: 'Polygon',
    coordinates: [
      [
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
        [-106.0746, 42.1485],
      ],
    ],
    description: ['Washington'],
  },
  tenant_id: '00000000-0000-0000-0000-000000000000',
  originalId: '1234',
  updatedAt: '2024-08-26T00:00:00',
  website: 'https://www.example.com/',
  organizationUrl: 'https://www.example.org/',
  translation: {
    displayName: 'FINANCIAL AND FOOD ASSISTANCE | EXAMPLE ORGANIZATION',
    fees: 'n/a',
    hours:
      'Monday 11:00am - 4:30pm;Tuesday 11:00am - 6:00pm;Wednesday 11:00am - 4:30pm;Thursday 11:00am - 6:00pm',
    locale: 'en',
    taxonomies: [
      {
        code: 'CW-0000.0000',
        name: 'Rental Deposit Assistance',
      },
    ],
    serviceName: 'FINANCIAL AND FOOD ASSISTANCE',
    eligibilities: 'Rental Assistance is limited to families and individuals.',
    requiredDocuments: [],
    applicationProcess: 'Walk-In;Call',
    alert:
      'We are currently experiencing high call volumes. Please be patient and leave a message if you are unable to reach us.',
    serviceDescription:
      'Emergency financial assistance to help with:\n- Rental and utility assistance\n- Help with first month rent\n- Utility assistance \nFood Pantry including items\n- Fresh and Shelf-Stable Food\n- Personal hygiene items\n- Diapers\n- Prescriptions',
    organizationDescription:
      'We are a nonprofit community based volunteer organizations with goals to alleviate poverty and homelessness, encourage self-sufficiency, to allocate funds and resources efficiently, and to provide a "hands-up" to those in need.',
    languages: ['English', 'Spanish'],
  },
  facetsEn: [
    {
      code: 'Benton County',
      taxonomyName: 'Area Served by County',
      termName: 'Benton County',
    },
    {
      code: 'People with low income',
      taxonomyName: 'Specialization',
      termName: 'People with low income',
    },
  ],
};
