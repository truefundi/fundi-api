import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodingService } from './geocoding.service';

describe('GeocodingService', () => {
  const createService = () =>
    new GeocodingService({
      get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
    } as unknown as ConfigService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns coordinates and display name from the configured provider response', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            lat: '-1.9536',
            lon: '30.0606',
            display_name: 'Kimihurura, Kigali, Rwanda',
          },
        ]),
        { status: 200 },
      ),
    );
    const service = createService();

    await expect(service.geocodeMany(['Kimihurura, Kigali'])).resolves.toEqual([
      {
        query: 'Kimihurura, Kigali',
        displayName: 'Kimihurura, Kigali, Rwanda',
        latitude: -1.9536,
        longitude: 30.0606,
      },
    ]);
    const [request, options] = fetch.mock.calls[0];
    expect(new URL(String(request)).searchParams.get('q')).toBe(
      'Kimihurura, Kigali',
    );
    expect(options).toEqual(
      expect.objectContaining({
        headers: { 'User-Agent': 'FundiBackend/0.1.0' },
      }),
    );
  });

  it('reports a clear error if the provider cannot find the requested place', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await expect(
      createService().geocodeMany(['Unknown Place']),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects malformed or out-of-range provider coordinates', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { lat: null, lon: '200', display_name: 'Invalid place result' },
          ]),
          { status: 200 },
        ),
      );

    await expect(
      createService().geocodeMany(['Invalid place']),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reports provider network failures as service unavailable', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'));

    await expect(
      createService().geocodeMany(['Kigali']),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
