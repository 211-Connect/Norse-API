import { Controller, Get, Param, Version } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { ApiHeader, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';

@ApiTags('Resource')
@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Get(':id')
  @Version('1')
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    example: {
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
        eligibilities:
          'Rental Assistance is limited to families and individuals.',
        requiredDocuments: [],
        applicationProcess: 'Walk-In;Call',
        serviceDescription:
          'Emergency financial assistance to help with:\n- Rental and utility assistance\n- Help with first month rent\n- Utility assistance \nFood Pantry including items\n- Fresh and Shelf-Stable Food\n- Personal hygiene items\n- Diapers\n- Prescriptions',
        organizationDescription:
          'We are a nonprofit community based volunteer organizations with goals to alleviate poverty and homelessness, encourage self-sufficiency, to allocate funds and resources efficiently, and to provide a "hands-up" to those in need.',
        languages: ['English', 'Spanish'],
      },
    },
  })
  getResourceById(
    @Param('id') id,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.resourceService.findById(id, {
      headers,
    });
  }

  @Get('original/:id')
  @Version('1')
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'id', description: 'Original Resource ID' }) // Updated description
  @ApiResponse({
    status: 200,
    example: {
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
        eligibilities:
          'Rental Assistance is limited to families and individuals.',
        requiredDocuments: [],
        applicationProcess: 'Walk-In;Call',
        serviceDescription:
          'Emergency financial assistance to help with:\n- Rental and utility assistance\n- Help with first month rent\n- Utility assistance \nFood Pantry including items\n- Fresh and Shelf-Stable Food\n- Personal hygiene items\n- Diapers\n- Prescriptions',
        organizationDescription:
          'We are a nonprofit community based volunteer organizations with goals to alleviate poverty and homelessness, encourage self-sufficiency, to allocate funds and resources efficiently, and to provide a "hands-up" to those in need.',
        languages: ['English', 'Spanish'],
      },
    },
  })
  getResourceByOriginalId(
    @Param('id') id: string, // The path parameter named id, but it is original ID
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.resourceService.findByOriginalId(id, {
      headers,
    });
  }
}
