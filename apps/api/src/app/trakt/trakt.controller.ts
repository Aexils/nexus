import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TraktList, TraktMediaKind, TraktNewList, TraktTitle } from '@nexus/shared-types';
import { TraktService } from './trakt.service';

function mediaKind(kind: string): TraktMediaKind {
  if (kind !== 'movie' && kind !== 'show') throw new BadRequestException(`Type inconnu : ${kind}`);
  return kind;
}

@Controller('trakt')
export class TraktController {
  constructor(private readonly trakt: TraktService) {}

  @Delete('devices/:device')
  @HttpCode(204)
  revoke(@Param('device') device: string): Promise<void> {
    return this.trakt.revokeDevice(device);
  }

  @Get('lists')
  lists(): Promise<TraktList[]> {
    return this.trakt.lists();
  }

  @Post('lists')
  createList(@Body() list: TraktNewList): Promise<TraktList> {
    return this.trakt.createList(list);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  deleteList(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.trakt.deleteList(id);
  }

  @Get('lists/:id/items')
  listItems(@Param('id', ParseIntPipe) id: number): Promise<TraktTitle[]> {
    return this.trakt.listItems(id);
  }

  @Post('lists/:id/items/:kind/:tmdb')
  @HttpCode(204)
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Param('tmdb', ParseIntPipe) tmdb: number,
  ): Promise<void> {
    return this.trakt.addListItem(id, mediaKind(kind), tmdb);
  }

  @Delete('lists/:id/items/:kind/:tmdb')
  @HttpCode(204)
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Param('tmdb', ParseIntPipe) tmdb: number,
  ): Promise<void> {
    return this.trakt.removeListItem(id, mediaKind(kind), tmdb);
  }

  @Get('search')
  search(@Query('q') query = ''): Promise<TraktTitle[]> {
    return query.trim() ? this.trakt.search(query.trim()) : Promise.resolve([]);
  }

  @Put('shows/:slug/loop')
  @HttpCode(204)
  addLoop(@Param('slug') slug: string): Promise<void> {
    return this.trakt.setLoop(slug, true);
  }

  @Delete('shows/:slug/loop')
  @HttpCode(204)
  removeLoop(@Param('slug') slug: string): Promise<void> {
    return this.trakt.setLoop(slug, false);
  }

  @Get('hidden')
  hidden(): Promise<TraktTitle[]> {
    return this.trakt.hiddenShows();
  }

  @Put('hidden/:tmdb')
  @HttpCode(204)
  hide(@Param('tmdb', ParseIntPipe) tmdb: number): Promise<void> {
    return this.trakt.setHidden(tmdb, true);
  }

  @Delete('hidden/:tmdb')
  @HttpCode(204)
  unhide(@Param('tmdb', ParseIntPipe) tmdb: number): Promise<void> {
    return this.trakt.setHidden(tmdb, false);
  }
}
