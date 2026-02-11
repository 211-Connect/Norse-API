# Geocoding API

This module provides a secure proxy for Mapbox geocoding services, preventing API key exposure in the frontend and adding caching for improved performance.

## Features

- **Forward Geocoding**: Convert addresses to coordinates
- **Reverse Geocoding**: Convert coordinates to addresses
- **Mapbox SDK**: Uses the official [@mapbox/mapbox-sdk](https://www.npmjs.com/package/@mapbox/mapbox-sdk) for reliable API communication
- **Redis Caching**: 7-day cache TTL to reduce Mapbox API calls
- **Swagger Documentation**: Full API documentation with request/response types
- **Error Handling**: Comprehensive error handling and logging

## Configuration

Add the following environment variable to your `.env` file:

```env
MAPBOX_API_KEY=your_mapbox_api_key_here
```

## API Endpoints

### Forward Geocoding

**GET** `/geocoding/forward`

Convert a human-readable address into geographic coordinates.

**Query Parameters:**

- `address` (required): Address to geocode (e.g., "123 Main St, New York, NY")
- `locale` (optional): Language locale for response (default: "en")
- `limit` (optional): Maximum number of results (1-10, default: 5)

**Example Request:**

```
GET /geocoding/forward?address=123%20Main%20St,%20New%20York&locale=en&limit=5
```

**Example Response:**

```json
[
  {
    "type": "coordinates",
    "address": "123 Main St, New York, NY 10001, United States",
    "coordinates": [-74.006, 40.7128],
    "postcode": "10001",
    "place": "New York",
    "district": "Manhattan",
    "region": "New York",
    "country": "United States"
  }
]
```

### Reverse Geocoding

**GET** `/geocoding/reverse`

Convert geographic coordinates into a human-readable address.

**Query Parameters:**

- `coordinates` (required): Coordinates in format "longitude,latitude" (e.g., "-74.006,40.7128")
- `locale` (optional): Language locale for response (default: "en")

**Example Request:**

```
GET /geocoding/reverse?coordinates=-74.006,40.7128&locale=en
```

**Example Response:**

```json
[
  {
    "address": "123 Main St, New York, NY 10001, United States",
    "coordinates": [-74.006, 40.7128],
    "postcode": "10001",
    "place": "New York",
    "region": "New York",
    "country": "United States"
  }
]
```

## Headers

All requests require the following header:

- `x-api-version: 1`

## Caching Strategy

The service implements Redis caching with the following strategy:

- **Cache Keys**: Generated based on request parameters (address/coordinates, locale, limit)
- **TTL**: 7 days (604,800,000 milliseconds)
- **Cache Hit**: Results returned immediately from Redis
- **Cache Miss**: Fetches from Mapbox API and stores in Redis

## Migration from Frontend

### Before (Frontend Direct Call)

```typescript
import { MAPBOX_API_KEY } from '@/constants';

const searchParams = new URLSearchParams({
  access_token: MAPBOX_API_KEY,
  country: 'US',
  autocomplete: 'true',
  language: locale,
});

const data = await fetch(
  `https://api.mapbox.com/geocoding/v5/mapbox.places/${address}.json?${searchParams}`,
);
```

### After (Backend Proxy)

```typescript
const response = await fetch(
  `/api/v1/geocoding/forward?address=${encodeURIComponent(address)}&locale=${locale}&limit=5`,
  {
    headers: {
      'x-api-version': '1',
    },
  },
);

const data = await response.json();
```

## Error Handling

The API returns standard HTTP status codes:

- **200 OK**: Successful request
- **400 Bad Request**: Invalid parameters (e.g., missing address, invalid coordinates format)
- **500 Internal Server Error**: Mapbox API error or configuration issue

## Testing

Run the unit tests:

```bash
npm test -- geocoding
```

## Swagger Documentation

Access the interactive API documentation at:

```
http://localhost:8080/api-docs
```

Look for the "Geocoding" tag to explore the endpoints.
