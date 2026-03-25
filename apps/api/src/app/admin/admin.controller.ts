import {
  Controller, Get, Patch, Delete, Body, Query, Param, ParseIntPipe, BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  getCategories() { return this.svc.getCategories(); }

  @Patch('categories')
  renameCategory(@Body() body: { oldName: string; newName: string; cascade?: boolean }) {
    const { oldName, newName, cascade = false } = body;
    if (!oldName?.trim() || !newName?.trim()) throw new BadRequestException('Champs manquants');
    return this.svc.renameCategory(oldName, newName, cascade);
  }

  @Delete('categories')
  deleteCategory(@Query('name') name: string) {
    if (!name?.trim()) throw new BadRequestException('name manquant');
    return this.svc.deleteCategory(name);
  }

  // ── Subcategories ─────────────────────────────────────────────────────────

  @Get('subcategories')
  getSubcategories() { return this.svc.getSubcategories(); }

  @Patch('subcategories')
  renameSubcategory(@Body() body: {
    oldName: string; oldCategory: string;
    newName: string; newCategory: string;
    cascade?: boolean;
  }) {
    const { oldName, oldCategory, newName, newCategory, cascade = false } = body;
    if (!oldName?.trim() || !oldCategory?.trim() || !newName?.trim() || !newCategory?.trim()) {
      throw new BadRequestException('Champs manquants');
    }
    return this.svc.renameSubcategory(oldName, oldCategory, newName, newCategory, cascade);
  }

  @Delete('subcategories')
  deleteSubcategory(@Query('name') name: string, @Query('category') category: string) {
    if (!name?.trim() || !category?.trim()) throw new BadRequestException('Paramètres manquants');
    return this.svc.deleteSubcategory(name, category);
  }

  // ── Enseignes ─────────────────────────────────────────────────────────────

  @Get('enseignes')
  getEnseignes() { return this.svc.getEnseignes(); }

  @Patch('enseignes')
  renameEnseigne(@Body() body: {
    oldName: string; oldSubcategory: string;
    newName: string; newSubcategory: string;
    cascade?: boolean;
  }) {
    const { oldName, oldSubcategory, newName, newSubcategory, cascade = false } = body;
    if (!oldName?.trim() || !oldSubcategory?.trim() || !newName?.trim() || !newSubcategory?.trim()) {
      throw new BadRequestException('Champs manquants');
    }
    return this.svc.renameEnseigne(oldName, oldSubcategory, newName, newSubcategory, cascade);
  }

  @Delete('enseignes')
  deleteEnseigne(@Query('name') name: string, @Query('subcategory') subcategory: string) {
    if (!name?.trim() || !subcategory?.trim()) throw new BadRequestException('Paramètres manquants');
    return this.svc.deleteEnseigne(name, subcategory);
  }

  // ── DB Explorer ───────────────────────────────────────────────────────────

  @Get('schema')
  getSchema() { return this.svc.getSchema(); }

  @Get('table/:name')
  getTableData(@Param('name') name: string) {
    try {
      return this.svc.getTableData(name);
    } catch {
      throw new BadRequestException('Table non autorisée');
    }
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  @Get('expenses')
  getAllExpenses() { return this.svc.getAllExpenses(); }

  @Delete('expenses/:id')
  deleteExpense(@Param('id', ParseIntPipe) id: number) {
    return { deleted: this.svc.deleteExpense(id) };
  }
}
