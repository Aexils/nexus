import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AbsService } from './abs.service';

@Controller('abs')
export class AbsController {
  constructor(private readonly abs: AbsService) {}

  @Get('library')
  getLibrary() {
    return this.abs.getLibrary();
  }

  @Get('cover/:id')
  async getCover(@Param('id') id: string, @Res() res: Response) {
    const result = await this.abs.getCover(id);
    if (!result) { res.status(404).end(); return; }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // browser caches covers for 1 day
    res.end(result.buffer);
  }
}
