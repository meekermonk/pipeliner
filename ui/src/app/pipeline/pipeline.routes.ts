import { Routes } from '@angular/router';

export const PIPELINE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pipeline-list.component').then(m => m.PipelineListComponent),
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./pipeline-editor.component').then(m => m.PipelineEditorComponent),
  },
];
