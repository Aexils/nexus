import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AbsService } from './abs.service';
import { NexusUser } from '@nexus/shared-types';

@Controller('abs')
export class AbsController {
  constructor(private readonly abs: AbsService) {}

  @Get('library')
  getLibrary(@Query('userId') userId?: string) {
    const user: NexusUser = userId === 'marion' ? 'marion' : 'alexis';
    return this.abs.getLibrary(user);
  }

  @Get('cover/:id')
  async getCover(
    @Param('id') id: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const user: NexusUser = userId === 'marion' ? 'marion' : 'alexis';
    const result = await this.abs.getCover(id, user);
    if (!result) { res.status(404).end(); return; }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(result.buffer);
  }
}
