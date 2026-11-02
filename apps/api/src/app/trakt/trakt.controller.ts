import { Controller, Delete, HttpCode, Param } from '@nestjs/common';
import { TraktService } from './trakt.service';

@Controller('trakt')
export class TraktController {
  constructor(private readonly trakt: TraktService) {}

  @Delete('devices/:device')
  @HttpCode(204)
  revoke(@Param('device') device: string): Promise<void> {
    return this.trakt.revokeDevice(device);
  }
}
