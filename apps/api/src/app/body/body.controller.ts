import {
  Controller, Get, Post, Put, Delete, Body, Param,
  Headers, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { BodyService } from './body.service';
import { BodyMeasurement, BodySettings } from '@nexus/shared-types';

@Controller('body')
export class BodyController {
  constructor(private readonly bodyService: BodyService) {}

  private auth(token: string | undefined): void {
    if (!token || !this.bodyService.verifyToken(token)) {
      throw new UnauthorizedException('Token invalide');
    }
  }

  // ── Public ────────────────────────────────────────────────────────────────

  @Get('status')
  status(): { hasPassword: boolean } {
    return { hasPassword: this.bodyService.hasPassword() };
  }

  @Post('setup')
  setup(@Body() body: { password: string }): { ok: boolean; token: string } {
    if (this.bodyService.hasPassword()) {
      throw new BadRequestException('Mot de passe déjà configuré');
    }
    if (!body.password || body.password.length < 4) {
      throw new BadRequestException('Mot de passe trop court (min 4 caractères)');
    }
    const token = this.bodyService.setupPassword(body.password);
    return { ok: true, token };
  }

  @Post('login')
  login(@Body() body: { password: string }): { ok: boolean; token?: string } {
    if (!body.password) throw new BadRequestException('Mot de passe requis');
    const token = this.bodyService.login(body.password);
    if (!token) return { ok: false };
    return { ok: true, token };
  }

  /** Validate a stored token (called on page load) */
  @Post('verify')
  verify(@Body() body: { token: string }): { ok: boolean } {
    return { ok: this.bodyService.verifyToken(body.token ?? '') };
  }

  // ── Protected ─────────────────────────────────────────────────────────────

  @Post('change-password')
  changePassword(
    @Headers('x-body-token') token: string,
    @Body() body: { oldPassword: string; newPassword: string },
  ): { ok: boolean; token: string } {
    this.auth(token);
    if (!body.newPassword || body.newPassword.length < 4) {
      throw new BadRequestException('Nouveau mot de passe trop court (min 4 caractères)');
    }
    const newToken = this.bodyService.changePassword(body.oldPassword, body.newPassword);
    if (!newToken) throw new UnauthorizedException('Ancien mot de passe incorrect');
    return { ok: true, token: newToken };
  }

  @Get('settings')
  getSettings(@Headers('x-body-token') token: string): BodySettings {
    this.auth(token);
    return this.bodyService.getSettings();
  }

  @Put('settings')
  updateSettings(
    @Headers('x-body-token') token: string,
    @Body() body: Partial<BodySettings>,
  ): BodySettings {
    this.auth(token);
    const { hasPassword: _hp, ...rest } = body as any;
    this.bodyService.updateSettings(rest);
    return this.bodyService.getSettings();
  }

  @Get('measurements')
  getMeasurements(@Headers('x-body-token') token: string): BodyMeasurement[] {
    this.auth(token);
    return this.bodyService.getMeasurements();
  }

  @Post('measurements')
  upsertMeasurement(
    @Headers('x-body-token') token: string,
    @Body() body: { date: string } & Partial<BodyMeasurement>,
  ): BodyMeasurement {
    this.auth(token);
    if (!body.date) throw new BadRequestException('Date requise');
    const { date, id: _id, createdAt: _ca, ...data } = body as any;
    return this.bodyService.upsertMeasurement(date, data);
  }

  @Delete('measurements/:id')
  deleteMeasurement(
    @Headers('x-body-token') token: string,
    @Param('id') id: string,
  ): { ok: boolean } {
    this.auth(token);
    return { ok: this.bodyService.deleteMeasurement(parseInt(id, 10)) };
  }
}
