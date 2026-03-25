import {
  Controller, Post, Get, Delete, Patch, Put,
  Body, Param, Query,
  ParseIntPipe, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ExpenseService } from './expense.service';

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly svc: ExpenseService) {}

  // ── Personal budget endpoints (must come before :id patterns) ─────────────

  @Get('personal')
  getPersonalExpenses(
    @Query('userId') userId: string,
    @Query('month')  month: string,
  ) {
    if (!userId || !month) throw new BadRequestException('userId et month requis');
    return this.svc.getPersonalExpenses(userId, month);
  }

  @Post('personal')
  addPersonalExpense(@Body() body: {
    userId: string; category: string; amount: number; date: string; comment?: string;
  }) {
    const { userId, category, amount, date, comment = '' } = body;
    if (!userId || !category || !amount || !date) throw new BadRequestException('Champs manquants');
    if (!['alexis', 'marion'].includes(userId)) throw new BadRequestException('userId invalide');
    return this.svc.addPersonalExpense(userId, category, Number(amount), date, comment);
  }

  @Delete('personal/:id')
  deletePersonalExpense(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.deletePersonalExpense(id) };
  }

  @Get('budget-summary')
  getBudgetSummaries(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId requis');
    return this.svc.getBudgetSummaries(userId);
  }

  @Get('budget')
  getBudget(@Query('userId') userId: string, @Query('month') month: string) {
    if (!userId || !month) throw new BadRequestException('userId et month requis');
    return this.svc.getBudget(userId, month) ?? null;
  }

  @Put('budget')
  setBudget(@Body() body: { userId: string; month: string; income: number }) {
    const { userId, month, income } = body;
    if (!userId || !month || income === undefined) throw new BadRequestException('Champs manquants');
    if (!['alexis', 'marion'].includes(userId)) throw new BadRequestException('userId invalide');
    return this.svc.setBudget(userId, month, Number(income));
  }

  // ── Existing endpoints ────────────────────────────────────────────────────

  @Get('summaries')
  getSummaries() {
    return this.svc.getSummaries();
  }

  @Get('monthly-breakdown')
  getMonthlyBreakdown() {
    return this.svc.getMonthlyBreakdown();
  }

  @Get('categories')
  getCategories() { return this.svc.getCategories(); }

  @Post('categories')
  addCategory(@Body() body: { name: string }) {
    if (!body.name?.trim()) throw new BadRequestException('Nom manquant');
    return this.svc.addCategory(body.name);
  }

  @Get('subcategories')
  getSubcategories(@Query('category') category: string) {
    if (!category) throw new BadRequestException('category manquant');
    return this.svc.getSubcategories(category);
  }

  @Post('subcategories')
  addSubcategory(@Body() body: { name: string; category: string }) {
    if (!body.name?.trim() || !body.category?.trim()) throw new BadRequestException('Champs manquants');
    return this.svc.addSubcategory(body.name, body.category);
  }

  @Get('enseignes')
  getEnseignes(@Query('subcategory') subcategory: string) {
    if (!subcategory) throw new BadRequestException('subcategory manquant');
    return this.svc.getEnseignes(subcategory);
  }

  @Post('enseignes')
  addEnseigne(@Body() body: { name: string; subcategory: string }) {
    if (!body.name?.trim() || !body.subcategory?.trim()) throw new BadRequestException('Champs manquants');
    return this.svc.addEnseigne(body.name, body.subcategory);
  }

  @Get()
  findAll(
    @Query('month')    month?: string,
    @Query('paidBy')   paidBy?: string,
    @Query('category') category?: string,
  ) {
    return this.svc.findAll({ month, paidBy, category });
  }

  @Post()
  create(@Body() body: {
    paidBy: string; enseigne?: string; category: string; subcategory?: string;
    amount: number; date: string; comment?: string;
  }) {
    const { paidBy, enseigne = '', category, subcategory = '', amount, date, comment = '' } = body;
    if (!paidBy || !category || !amount || !date) {
      throw new BadRequestException('Champs manquants');
    }
    if (!['alexis', 'marion'].includes(paidBy)) {
      throw new BadRequestException('paidBy invalide');
    }
    return this.svc.create(paidBy, enseigne, category, subcategory, Number(amount), date, comment);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      paidBy?: string; enseigne?: string; category?: string; subcategory?: string;
      amount?: number; date?: string; comment?: string;
    },
  ) {
    const updated = this.svc.update(id, {
      ...body,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
    });
    if (!updated) throw new NotFoundException('Dépense introuvable');
    return updated;
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.delete(id) };
  }
}
