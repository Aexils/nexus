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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  TraktCustomScreen,
  TraktCustomScreens,
  TraktList,
  TraktMediaKind,
  TraktNavEntry,
  TraktNewList,
  TraktPreview,
  TraktProviderLogo,
  TraktRowItem,
  TraktSettings,
  TraktSnapshotItem,
  TraktTitle,
} from '@nexus/shared-types';
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

  @Get('screens/:screen')
  screen(@Param('screen') screen: string): Promise<{ lists: number[]; slots: number }> {
    return this.trakt.screenLists(screen);
  }

  @Put('screens/:screen')
  setScreen(@Param('screen') screen: string, @Body('lists') lists: number[]): Promise<{ lists: number[]; slots: number }> {
    return this.trakt.setScreenLists(screen, lists);
  }

  @Get('custom-screens')
  customScreens(): Promise<TraktCustomScreens> {
    return this.trakt.customScreens();
  }

  @Post('custom-screens')
  createScreen(@Body() screen: { name: string; icon: string }): Promise<TraktCustomScreen> {
    return this.trakt.createScreen(screen);
  }

  @Put('custom-screens/order')
  @HttpCode(204)
  orderScreens(@Body('ids') ids: string[]): Promise<void> {
    return this.trakt.orderScreens(ids);
  }

  @Put('custom-screens/:id')
  updateScreen(@Param('id') id: string, @Body() change: Partial<TraktCustomScreen>): Promise<TraktCustomScreen> {
    return this.trakt.updateScreen(id, change);
  }

  @Delete('custom-screens/:id')
  @HttpCode(204)
  deleteScreen(@Param('id') id: string): Promise<void> {
    return this.trakt.deleteScreen(id);
  }

  @Get('row-snapshots')
  rowSnapshots(): Promise<Record<string, TraktSnapshotItem[]>> {
    return this.trakt.rowSnapshots();
  }

  @Get('nav')
  nav(): Promise<TraktNavEntry[]> {
    return this.trakt.nav();
  }

  @Put('nav')
  saveNav(@Body('entries') entries: { key: string; hidden: boolean; name: string; icon: string }[]): Promise<TraktNavEntry[]> {
    return this.trakt.saveNav(entries);
  }

  @Get('settings')
  settings(): Promise<TraktSettings> {
    return this.trakt.settings();
  }

  @Post('settings')
  @HttpCode(204)
  changeSetting(@Body() command: { source: string; id: string; value: unknown }): Promise<void> {
    return this.trakt.changeSetting(command);
  }

  @Get('provider-logos')
  providerLogos(): Promise<TraktProviderLogo[]> {
    return this.trakt.providerLogos();
  }

  @Post('icons')
  uploadIcon(@Body('png') png: string): Promise<{ url: string }> {
    return this.trakt.uploadIcon(Buffer.from(png ?? '', 'base64'));
  }

  @Get('assets/:name')
  async asset(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const png = await this.trakt.asset(name);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' }).send(png);
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
