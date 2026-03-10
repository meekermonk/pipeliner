import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-pipeline-list',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <!-- Loading -->
    @if (loading) {
      <div class="loading-container">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Loading workflows...</p>
      </div>
    }

    <!-- Content -->
    @if (!loading) {
      <div class="page-container">
        <div class="page-header">
          <div class="header-text">
            <h1>Pipeliner</h1>
            <p class="subtitle">Build creative production workflows — concepting, asset generation, resizing, translations, and delivery</p>
          </div>
          <button mat-flat-button color="primary" class="new-btn" (click)="createTemplate()">
            <mat-icon>add</mat-icon>
            New Workflow
          </button>
        </div>

        <!-- Empty State -->
        @if (templates.length === 0) {
          <div class="empty-state">
            <div class="empty-illustration">
              <div class="empty-circle">
                <span class="material-symbols-outlined empty-icon">account_tree</span>
              </div>
              <div class="empty-flow-dots">
                <span class="dot dot-1"></span>
                <span class="dot-line"></span>
                <span class="dot dot-2"></span>
                <span class="dot-line"></span>
                <span class="dot dot-3"></span>
              </div>
            </div>
            <h3>Create your first workflow</h3>
            <p>Chain agents together to automate creative production — from briefing through asset generation to final delivery.</p>
            <button mat-flat-button color="primary" (click)="createTemplate()">
              <mat-icon>add</mat-icon>
              Create Workflow
            </button>
          </div>
        }

        <!-- Template Grid -->
        @if (templates.length > 0) {
          <div class="template-grid">
            @for (t of templates; track t.id || $index) {
              <div class="template-card" (click)="editTemplate(t)">
                <div class="card-color-bar" [style.background]="getWorkflowColor(t)"></div>
                <div class="card-content">
                  <div class="card-header">
                    <div class="card-icon-wrap" [style.background]="getWorkflowColor(t) + '14'">
                      <span class="material-symbols-outlined card-icon" [style.color]="getWorkflowColor(t)">account_tree</span>
                    </div>
                    <div class="card-title-block">
                      <h3 class="card-name">{{ t.name }}</h3>
                      <p class="card-description">{{ t.description || 'No description' }}</p>
                    </div>
                  </div>

                  <div class="card-meta">
                    <span class="meta-chip">
                      <span class="material-symbols-outlined">hub</span>
                      {{ t.nodes?.length || 0 }} nodes
                    </span>
                    <span class="meta-chip">
                      <span class="material-symbols-outlined">schedule</span>
                      {{ formatDate(t.updated_at || t.created_at) }}
                    </span>
                  </div>

                  <div class="card-actions">
                    <button mat-flat-button color="primary" class="action-btn" (click)="runPipeline(t); $event.stopPropagation()">
                      <mat-icon>play_arrow</mat-icon>
                      Run
                    </button>
                    <button mat-stroked-button class="action-btn" (click)="editTemplate(t); $event.stopPropagation()">
                      <mat-icon>edit</mat-icon>
                      Edit
                    </button>
                    <button mat-icon-button class="delete-btn" (click)="deleteTemplate(t); $event.stopPropagation()">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  </div>
                </div>
              </div>
            }

            <!-- New workflow card -->
            <div class="template-card new-card" (click)="createTemplate()">
              <div class="new-card-content">
                <div class="new-card-icon">
                  <span class="material-symbols-outlined">add_circle</span>
                </div>
                <span class="new-card-label">New Workflow</span>
              </div>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      --ca-elevation-1: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
      --ca-elevation-2: 0 2px 6px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06);
      --ca-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --ca-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      gap: 12px;
      color: var(--color-on-surface-variant);
    }

    .page-container {
      padding: 32px 40px;
      max-width: 1200px;
      margin: 0 auto;
      animation: fadeIn 350ms var(--ca-ease-out) both;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
      gap: 20px;

      h1 {
        font-size: 28px;
        font-weight: 700;
        color: var(--color-on-surface);
        margin: 0;
        letter-spacing: -0.5px;
      }
    }

    .subtitle {
      font-size: 13px;
      color: var(--color-on-surface-variant);
      margin: 4px 0 0;
      max-width: 480px;
      line-height: 1.5;
    }

    .new-btn {
      flex-shrink: 0;
      border-radius: 8px !important;
      font-weight: 500;
      transition: all 200ms var(--ca-ease-out);
      &:active { transform: scale(0.97); }
    }

    /* ─── Empty State ─── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 420px;
      gap: 12px;
      text-align: center;

      h3 { font-size: 18px; font-weight: 600; color: var(--color-on-surface); margin: 0; }
      p { color: var(--color-on-surface-variant); font-size: 14px; max-width: 400px; margin: 0; line-height: 1.5; }
    }

    .empty-illustration {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .empty-circle {
      width: 80px; height: 80px; border-radius: 50%;
      background: var(--color-primary-container);
      display: flex; align-items: center; justify-content: center;
    }

    .empty-icon { font-size: 36px; color: var(--color-primary); }

    .empty-flow-dots {
      display: flex; align-items: center; gap: 4px;
      .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--color-outline); }
      .dot-1 { border-color: #1A73E8; }
      .dot-2 { border-color: #E8710A; }
      .dot-3 { border-color: #9334E6; }
      .dot-line { width: 24px; height: 2px; background: var(--color-outline-variant); }
    }

    /* ─── Card Grid ─── */
    .template-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 20px;
    }

    .template-card {
      background: var(--color-surface);
      border: 1px solid var(--color-outline-variant);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      box-shadow: var(--ca-elevation-1);
      transition: transform 200ms var(--ca-ease-out),
                  box-shadow 200ms var(--ca-ease-out),
                  border-color 200ms var(--ca-ease-out);

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--ca-elevation-2);
        border-color: var(--color-outline);
      }
      &:active { transform: scale(0.99); }
    }

    .card-color-bar { height: 3px; width: 100%; }

    .card-content {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card-header { display: flex; align-items: flex-start; gap: 12px; }

    .card-icon-wrap {
      width: 40px; height: 40px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }

    .card-icon { font-size: 22px; width: 22px; height: 22px; }

    .card-title-block { flex: 1; min-width: 0; }

    .card-name {
      font-size: 15px; font-weight: 600; color: var(--color-on-surface); margin: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .card-description {
      font-size: 13px; color: var(--color-on-surface-variant); margin: 2px 0 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; line-height: 1.4;
    }

    .card-meta { display: flex; gap: 6px; flex-wrap: wrap; }

    .meta-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; font-weight: 500; color: var(--color-on-surface-variant);
      background: var(--color-surface-variant); padding: 3px 10px; border-radius: 12px;
      .material-symbols-outlined { font-size: 14px; width: 14px; height: 14px; }
    }

    .card-actions {
      display: flex; align-items: center; gap: 8px;
      padding-top: 12px; border-top: 1px solid var(--color-outline-variant);
    }

    .action-btn {
      font-size: 13px; border-radius: 8px !important;
      transition: all 200ms var(--ca-ease-out);
      &:active { transform: scale(0.97); }
    }

    .delete-btn {
      margin-left: auto;
      color: var(--color-on-surface-variant);
      transition: color 150ms;
      &:hover { color: var(--color-error); }
    }

    /* ─── New Workflow Card ─── */
    .new-card {
      border-style: dashed;
      border-color: var(--color-outline);
      background: var(--color-surface-dim);
      box-shadow: none;

      &:hover {
        border-color: var(--color-primary);
        background: #e8f0fe;
        box-shadow: none;
        .new-card-icon .material-symbols-outlined { color: var(--color-primary); }
        .new-card-label { color: var(--color-primary); }
      }
    }

    .new-card-content {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 200px; gap: 8px;
    }

    .new-card-icon {
      .material-symbols-outlined { font-size: 40px; color: var(--color-outline); transition: color 200ms; }
    }

    .new-card-label {
      font-size: 13px; font-weight: 500;
      color: var(--color-on-surface-variant); transition: color 200ms;
    }
  `],
})
export class PipelineListComponent implements OnInit {
  templates: any[] = [];
  loading = true;

  private workflowColors = ['#1A73E8', '#E8710A', '#0D652D', '#9334E6', '#D93025'];

  constructor(
    private api: ApiService,
    private router: Router,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
  }

  getWorkflowColor(template: any): string {
    const idx = this.templates.indexOf(template);
    return this.workflowColors[idx % this.workflowColors.length];
  }

  private loadTemplates(): void {
    this.loading = true;
    this.api.listPipelineTemplates().subscribe({
      next: (data) => {
        this.templates = data;
        this.loading = false;
      },
      error: () => {
        this.templates = [];
        this.loading = false;
      },
    });
  }

  createTemplate(): void {
    this.api.createPipelineTemplate({ name: 'Untitled Workflow' }).subscribe({
      next: (result) => {
        this.router.navigate(['/pipeline', result.id]);
      },
      error: () => {
        this.snackBar.open('Failed to create workflow', 'Dismiss', { duration: 3000 });
        this.loadTemplates();
      },
    });
  }

  editTemplate(template: any): void {
    const id = template.id || template.template_id;
    if (id) {
      this.router.navigate(['/pipeline', id]);
    }
  }

  runPipeline(template: any): void {
    const id = template.id || template.template_id;
    this.api.startPipelineRun(id).subscribe({
      next: () => {
        this.snackBar.open('Workflow run started', '', { duration: 3000 });
        this.loadTemplates();
      },
      error: () => {
        this.snackBar.open('Failed to start run', 'Dismiss', { duration: 3000 });
      },
    });
  }

  deleteTemplate(template: any): void {
    const id = template.id || template.template_id;
    this.api.deletePipelineTemplate(id).subscribe({
      next: () => {
        this.templates = this.templates.filter(t => t !== template);
        this.snackBar.open('Workflow deleted', '', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Failed to delete workflow', 'Dismiss', { duration: 3000 });
      },
    });
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return 'Just now';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
