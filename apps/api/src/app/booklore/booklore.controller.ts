import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BookloreService } from './booklore.service';
import { NexusUser } from '@nexus/shared-types';

@Controller('booklore')
export class BookloreController {
  constructor(private readonly booklore: BookloreService) {}

  @Get('library')
  getLibrary(@Query('userId') userId?: string) {
    const user: NexusUser = userId === 'marion' ? 'marion' : 'alexis';
    return this.booklore.getLibrary(user);
  }

  @Get('cover/:id')
  async getCover(@Param('id') id: string, @Res() res: Response) {
    const result = await this.booklore.getCover(parseInt(id, 10));
    if (!result) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(result.buffer);
  }
}
