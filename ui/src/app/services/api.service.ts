import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = '/api';

  constructor(private http: HttpClient) {}

  // Pipeline Templates
  listPipelineTemplates() {
    return this.http.get<any[]>(`${this.baseUrl}/pipelines/`);
  }
  createPipelineTemplate(data: { name: string; description?: string }) {
    return this.http.post<{ id: string }>(`${this.baseUrl}/pipelines/`, data);
  }
  getPipelineTemplate(id: string) {
    return this.http.get<any>(`${this.baseUrl}/pipelines/${id}`);
  }
  updatePipelineTemplate(id: string, data: any) {
    return this.http.put<any>(`${this.baseUrl}/pipelines/${id}`, data);
  }
  deletePipelineTemplate(id: string) {
    return this.http.delete(`${this.baseUrl}/pipelines/${id}`);
  }
  startPipelineRun(templateId: string, inputs: any = {}) {
    return this.http.post<any>(`${this.baseUrl}/pipelines/${templateId}/run`, { inputs });
  }
  listPipelineRuns(templateId: string) {
    return this.http.get<any[]>(`${this.baseUrl}/pipelines/${templateId}/runs`);
  }
  getPipelineRun(runId: string) {
    return this.http.get<any>(`${this.baseUrl}/pipelines/runs/${runId}`);
  }
  // Agent registry
  getAgentRegistry() {
    return this.http.get<any[]>(`${this.baseUrl}/agents/registry`);
  }
  // I/O
  uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${this.baseUrl}/io/upload`, formData);
  }
  importDrive(data: { file_id: string; file_name: string; mime_type: string; access_token: string }) {
    return this.http.post<any>(`${this.baseUrl}/io/import-drive`, data);
  }
  exportDoc(data: { title: string; content: string; folder_id?: string; access_token: string }) {
    return this.http.post<any>(`${this.baseUrl}/io/export-doc`, data);
  }
}
