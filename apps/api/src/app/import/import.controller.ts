import {
  Controller, Get, Post, Delete, Body, Param, Query,
  ParseIntPipe, BadRequestException, NotFoundException,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { ApplyDecision, ExpensePaidBy, ImportFormat } from '@nexus/shared-types';

/**
 * `@types/multer` n'est pas installé (multer n'arrive qu'en dépendance
 * transitive de @nestjs/platform-express) — on décrit ici le peu qu'on utilise
 * du fichier téléversé plutôt que d'ajouter une dépendance de types.
 */
interface UploadedStatement {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const OWNERS: ExpensePaidBy[] = ['alexis', 'marion'];

@Controller('imports')
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  // ── Règles (avant les routes :id) ─────────────────────────────────────────

  @Get('rules')
  getRules() { return this.svc.getRules(); }

  @Post('rules')
  upsertRule(@Body() body: {
    pattern: string; enseigne: string; category: string;
    subcategory?: string; destination?: 'maison' | 'perso' | 'ignore';
    matchType?: 'exact' | 'contains' | 'regex'; priority?: number;
  }) {
    return this.svc.upsertRule(body);
  }

  /** Création en lot — c'est par là que passe un rattrapage de règles. */
  @Post('rules/bulk')
  upsertRules(@Body() body: { rules: Parameters<ImportService['upsertRule']>[0][] }) {
    if (!Array.isArray(body?.rules) || !body.rules.length) {
      throw new BadRequestException('Aucune règle fournie');
    }
    const created = body.rules.map(r => this.svc.upsertRule(r));
    const reclassified = this.svc.reclassifyPending();
    return { created: created.length, rules: created, ...reclassified };
  }

  @Delete('rules/:id')
  deleteRule(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.deleteRule(id) };
  }

  @Post('rules/seed')
  seedRules() { return this.svc.seedRulesFromHistory(); }

  // ── Diagnostic ────────────────────────────────────────────────────────────

  /** Les libellés qu'aucune règle ne couvre, groupés par motif suggéré. */
  @Get('unmatched')
  getUnmatched() { return this.svc.getUnmatched(); }

  @Get('health')
  getHealth() { return this.svc.getHealth(); }

  @Post('reclassify')
  reclassify(@Body() body: { batchId?: number } = {}) {
    return this.svc.reclassifyPending(body?.batchId);
  }

  // ── Lots ──────────────────────────────────────────────────────────────────

  @Get()
  getBatches(@Query('limit') limit?: string) {
    return this.svc.getBatches(limit ? Number(limit) : undefined);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @UploadedFile() file: UploadedStatement,
    @Body() body: { accountOwner: string; format?: ImportFormat },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Aucun fichier reçu');
    if (!OWNERS.includes(body?.accountOwner as ExpensePaidBy)) {
      throw new BadRequestException('accountOwner doit valoir « alexis » ou « marion »');
    }
    return this.svc.ingest(
      file.buffer, file.originalname, body.accountOwner as ExpensePaidBy, body.format,
    );
  }

  @Get(':id')
  getBatch(@Param('id', ParseIntPipe) id: number) {
    const batch = this.svc.getBatch(id);
    if (!batch) throw new NotFoundException('Lot introuvable');
    return batch;
  }

  @Get(':id/transactions')
  getStaged(
    @Param('id', ParseIntPipe) id: number,
    @Query('status') status?: string,
  ) {
    if (!this.svc.getBatch(id)) throw new NotFoundException('Lot introuvable');
    return this.svc.getStaged(id, status);
  }

  @Post(':id/apply')
  apply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decisions: ApplyDecision[] },
  ) {
    if (!Array.isArray(body?.decisions) || !body.decisions.length) {
      throw new BadRequestException('Aucune décision fournie');
    }
    return this.svc.apply(id, body.decisions);
  }

  @Delete(':id')
  deleteBatch(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.deleteBatch(id) };
  }
}
