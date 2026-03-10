import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GroundingDoc {
  uri: string;
  signed_url?: string;
  mime_type: string;
  name: string;
  text_content?: string;
  size?: number;
}

export interface Manifest {
  session_id: string;
  title: string;
  agent_outputs: Record<string, string>;
  grounding_docs: GroundingDoc[];
  conversations?: Record<string, any[]>;
  created_at: string;
  updated_at?: string;
}

@Injectable({ providedIn: 'root' })
export class ManifestService {
  private coreAgentsUrl = 'https://core-agents.mf4g.studio/v1';

  constructor(private http: HttpClient) {}

  fetchManifest(sessionId: string): Observable<Manifest> {
    return this.http.get<Manifest>(
      `${this.coreAgentsUrl}/sessions/${sessionId}/manifest`,
      { withCredentials: true }
    );
  }
}
