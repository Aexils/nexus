import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { KodiService } from './kodi.service';

@Controller('kodi')
export class KodiController {
  constructor(private readonly kodi: KodiService) {}

  @Get('status')
  getStatus() {
    return this.kodi.getStatus();
  }

  @Get('art')
  async getArt(@Query('url') url: string, @Res() res: Response) {
    if (!url) { res.status(400).end(); return; }
    const result = await this.kodi.getArt(url);
    if (!result) { res.status(404).end(); return; }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(result.buffer);
  }

  @Post('playpause')
  async playPause() {
    await this.kodi.togglePlayPause();
    return { ok: true };
  }

  @Post('stop')
  async stop() {
    await this.kodi.stop();
    return { ok: true };
  }

  @Post('seek')
  async seek(@Body() body: { positionSec: number }) {
    await this.kodi.seek(Number(body.positionSec));
    return { ok: true };
  }

  @Post('volume')
  async volume(@Body() body: { level: number }) {
    await this.kodi.setVolume(Number(body.level));
    return { ok: true };
  }
}
