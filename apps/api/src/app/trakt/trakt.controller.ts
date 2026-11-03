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
import { TraktList, TraktMediaKind, TraktNewList, TraktPreview, TraktRowItem, TraktTitle } from '@nexus/shared-types';
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

  @Get('home')
  home(): Promise<{ lists: number[]; slots: number }> {
    return this.trakt.homeLists();
  }

  @Put('home')
  setHome(@Body('lists') lists: number[]): Promise<{ lists: number[]; slots: number }> {
    return this.trakt.setHomeLists(lists);
  }

  @Get('rows/:name')
  row(@Param('name') name: string): Promise<TraktRowItem[]> {
    return this.trakt.row(name);
  }

  @Get('sources/preview')
  previewSource(
    @Query('provider', ParseIntPipe) provider: number,
    @Query('theme') theme = '',
    @Query('kinds') kinds = '',
  ): Promise<TraktPreview[]> {
    return this.trakt.previewSource(provider, theme, kinds);
  }

  @Get('titles')
  titles(@Query('q') query = ''): Promise<TraktPreview[]> {
    return query.trim() ? this.trakt.searchTitles(query.trim()) : Promise.resolve([]);
  }

  @Post('lists/:id/titles')
  @HttpCode(204)
  addTitle(
    @Param('id', ParseIntPipe) id: number,
    @Body() title: { kind: string; tmdb: number; title: string; year: number | null },
  ): Promise<void> {
    return this.trakt.addTitle(id, { ...title, kind: mediaKind(title.kind) });
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
