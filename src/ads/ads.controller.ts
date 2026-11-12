import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiNotFound } from '../common/decorators/api-error-responses.decorator';
import { AdsService } from './ads.service';
import { AdResponseDto } from './dto/ad-response.dto';
import { PublicAdsQueryDto } from './dto/ad.dto';

// The anonymously readable side of ads: the landing page renders these without a
// session, and the impression/click routes let it report engagement.
@ApiTags('Ads')
@Controller('api/v1/ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  @ApiOperation({
    summary: 'List ads visible right now',
    description:
      'Returns active ads whose scheduling window contains the current time, highest priority first. ' +
      'Pass `role` to include role-targeted ads alongside ALL-audience ads.',
  })
  @ApiResponse({ status: 200, description: 'Visible ads', type: [AdResponseDto] })
  list(@Query() query: PublicAdsQueryDto) {
    return this.ads.listPublic(query);
  }

  @Post(':id/impression')
  @ApiOperation({ summary: 'Record one impression for an ad' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated counters' })
  @ApiNotFound('No ad has this id.')
  recordImpression(@Param('id', ParseUUIDPipe) id: string) {
    return this.ads.recordImpression(id);
  }

  @Post(':id/click')
  @ApiOperation({ summary: 'Record one click for an ad' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated counters' })
  @ApiNotFound('No ad has this id.')
  recordClick(@Param('id', ParseUUIDPipe) id: string) {
    return this.ads.recordClick(id);
  }

  // The URL is stable per ad, so the cache is short: replacing the creative should be
  // visible quickly even though the stored object key changes.
  @Get(':id/image')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Download an ad creative' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The stored image bytes' })
  @ApiNotFound('No ad has this id, or it has no uploaded image.')
  async image(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.ads.readImage(id);
    return new StreamableFile(file.buffer, { type: file.mimeType });
  }
}
