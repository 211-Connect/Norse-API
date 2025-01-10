import { ApiQuery } from '@nestjs/swagger';

// Define the complex query schema as a const
const complexQuerySchemaSwagger = {
  type: 'object',
  properties: {
    OR: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          AND: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
      },
    },
    AND: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          AND: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          OR: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
      },
    },
  },
};

export const ApiQueryForComplexSearch = () =>
  ApiQuery({
    name: 'query',
    required: false,
    schema: {
      oneOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
        complexQuerySchemaSwagger,
      ],
    },
    description:
      'Search query. Can be a simple string, comma separated strings, or a JSON object with OR and AND nested conditions.',
  });
