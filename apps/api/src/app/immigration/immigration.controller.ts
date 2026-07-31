import {
  Controller, Get, Post, Patch, Put, Delete,
  Body, Param, ParseIntPipe, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { DocStatus, DOC_STATUS_ORDER } from '@nexus/shared-types';
import { ImmigrationService } from './immigration.service';

@Controller('immigration')
export class ImmigrationController {
  constructor(private readonly svc: ImmigrationService) {}

  @Get('overview')
  getOverview() {
    return this.svc.getOverview();
  }

  @Put('deadline')
  setDeadline(@Body() body: { deadline: string }) {
    const deadline = body?.deadline?.trim();
    if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      throw new BadRequestException('Date invalide (attendu YYYY-MM-DD)');
    }
    return { deadline: this.svc.setDeadline(deadline) };
  }

  @Patch('documents/:id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: DocStatus }) {
    if (!DOC_STATUS_ORDER.includes(body?.status)) {
      throw new BadRequestException('Statut invalide');
    }
    const doc = this.svc.setStatus(id, body.status);
    if (!doc) throw new NotFoundException('Document introuvable');
    return doc;
  }

  @Get('documents/:id/comments')
  getComments(@Param('id', ParseIntPipe) id: number) {
    if (!this.svc.documentExists(id)) throw new NotFoundException('Document introuvable');
    return this.svc.getComments(id);
  }

  @Post('documents/:id/comments')
  addComment(@Param('id', ParseIntPipe) id: number, @Body() body: { text: string }) {
    const text = body?.text?.trim();
    if (!text) throw new BadRequestException('Commentaire vide');
    if (!this.svc.documentExists(id)) throw new NotFoundException('Document introuvable');
    return this.svc.addComment(id, text);
  }

  @Delete('comments/:id')
  deleteComment(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.deleteComment(id) };
  }
}
