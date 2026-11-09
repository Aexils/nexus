import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  AggregatorPreferences,
  AggregatorPreferencesState,
  AggregatorPreview,
  AggregatorPreviewRequest,
} from '@nexus/shared-types';
import { WriteGuard } from '../auth/write.guard';
import { AggregatorService } from './aggregator.service';

@Controller('aggregator')
export class AggregatorController {
  constructor(private readonly aggregator: AggregatorService) {}

  @Get('preferences')
  preferences(): Promise<AggregatorPreferencesState> {
    return this.aggregator.get();
  }

  /** Seule écriture : session, origine et jeton anti-CSRF exigés ; version lue obligatoire. */
  @Put('preferences')
  @UseGuards(WriteGuard)
  save(@Body() body: { version?: unknown; preferences?: AggregatorPreferences }): Promise<AggregatorPreferencesState> {
    if (typeof body?.version !== 'number' || !Number.isInteger(body.version) || typeof body.preferences !== 'object') {
      throw new BadRequestException({ status: 'invalid', error: 'version et preferences attendus' });
    }
    return this.aggregator.save(body.version, body.preferences);
  }

  /** Lecture seule côté backend : rien n'est enregistré, rien n'est lu ni débridé. */
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: AggregatorPreviewRequest): Promise<AggregatorPreview> {
    return this.aggregator.preview(body);
  }
}
