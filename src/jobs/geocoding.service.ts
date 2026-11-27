import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodedLocation {
  query: string;
  displayName: string;
  latitude: number;
  longitude: number;
}

@Injectable()
export class GeocodingService {
  private lastRequestAt = 0;
  private rateLimitQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  async geocodeMany(locations: string[]): Promise<GeocodedLocation[]> {
    const results: GeocodedLocation[] = [];
    for (const location of locations) {
      await this.waitForRateLimit();
      results.push(await this.geocode(location));
    }
    return results;
  }

  private async geocode(query: string): Promise<GeocodedLocation> {
    const endpoint = this.config.get<string>(
      'geocoding.endpoint',
      'https://nominatim.openstreetmap.org/search',
    );
    const userAgent = this.config.get<string>(
      'geocoding.userAgent',
      'FundiBackend/0.1.0',
    );
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ServiceUnavailableException(
        'The geocoding provider endpoint is not a valid URL.',
      );
    }
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', query);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Location lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `The geocoding provider returned HTTP ${response.status}.`,
      );
    }
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      throw new BadGatewayException(
        'The geocoding provider returned an invalid response.',
      );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadGatewayException(
        `The location "${query}" could not be found. Try a more specific place name.`,
      );
    }
    const result: unknown = rows[0];
    if (
      result === null ||
      typeof result !== 'object' ||
      !('lat' in result) ||
      !('lon' in result) ||
      !('display_name' in result)
    ) {
      throw new BadGatewayException(
        'The geocoding provider returned an invalid location.',
      );
    }
    const latitude =
      typeof result.lat === 'string' ? Number(result.lat) : Number.NaN;
    const longitude =
      typeof result.lon === 'string' ? Number(result.lon) : Number.NaN;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      typeof result.display_name !== 'string'
    ) {
      throw new BadGatewayException(
        'The geocoding provider returned an invalid location.',
      );
    }
    return {
      query,
      displayName: result.display_name,
      latitude,
      longitude,
    };
  }

  private async waitForRateLimit() {
    let release!: () => void;
    const previous = this.rateLimitQueue;
    this.rateLimitQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const delay = Math.max(0, 1100 - (Date.now() - this.lastRequestAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
    release();
  }
}
