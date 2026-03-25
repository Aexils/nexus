import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { JellyfinService } from './jellyfin.service';

@Controller('jellyfin')
export class JellyfinController {
  constructor(private readonly jellyfin: JellyfinService) {}

  /** Fetch all library items (movies + series) with metadata */
  @Get('library')
  getLibrary() {
    return this.jellyfin.getLibrary();
  }

  /** Proxy Jellyfin item cover image (avoids CORS / auth exposure in browser) */
  @Get('image/:itemId')
  async image(@Param('itemId') itemId: string, @Res() res: Response): Promise<void> {
    const url = `${this.jellyfin.jellyfinUrl}/Items/${itemId}/Images/Primary?maxHeight=300&fillHeight=300&quality=90`;
    try {
      const upstream = await fetch(url, {
        headers: { 'X-Emby-Authorization': this.jellyfin.authHeader() },
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) { res.status(404).end(); return; }

      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
    } catch {
      res.status(502).end();
    }
  }
}
