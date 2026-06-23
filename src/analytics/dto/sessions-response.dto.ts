import { ApiProperty } from '@nestjs/swagger';
import type { UmamiSession } from '../types';

export class SessionsResponse implements UmamiSession {
  @ApiProperty({
    description: 'Session UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Website UUID the session belongs to',
    example: 'def-456',
  })
  websiteId: string;

  @ApiProperty({
    description: 'Hostname of the website',
    example: 'example.com',
  })
  hostname: string;

  @ApiProperty({
    description: 'Browser used during the session',
    example: 'Chrome',
  })
  browser: string;

  @ApiProperty({
    description: 'Operating system of the visitor',
    example: 'Windows',
  })
  os: string;

  @ApiProperty({
    description: 'Device type (desktop, mobile, tablet)',
    example: 'desktop',
  })
  device: string;

  @ApiProperty({
    description: 'Screen resolution of the visitor',
    example: '1920x1080',
  })
  screen: string;

  @ApiProperty({
    description: 'Browser language of the visitor',
    example: 'en-US',
  })
  language: string;

  @ApiProperty({
    description: 'Country code of the visitor',
    example: 'US',
  })
  country: string;

  @ApiProperty({
    description: 'Region/state of the visitor',
    example: 'California',
  })
  region: string;

  @ApiProperty({
    description: 'City of the visitor',
    example: 'San Francisco',
  })
  city: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of the first visit',
    example: '2025-01-01T00:00:00Z',
  })
  firstAt: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of the last visit',
    example: '2025-01-31T23:59:59Z',
  })
  lastAt: string;

  @ApiProperty({
    description: 'Number of visits in this session',
    example: 5,
  })
  visits: number;

  @ApiProperty({
    description: 'Number of page views in this session',
    example: 12,
  })
  views: number;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the session was created',
    example: '2025-01-01T00:00:00Z',
  })
  createdAt: string;
}
