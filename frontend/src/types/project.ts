// F08 D-Column-Identity: {id, name}. id is stable across renames.
export interface Column {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  columns: Column[];
  creatorId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

// Sent to POST /api/projects. slug is raw (service normalizes). columns optional.
export interface CreateProjectDto {
  name: string;
  slug: string;
  columns?: Column[];
}

// F27: PATCH /api/projects/:slug. Admin-only. Server blocks deleting a column
// that still has live tickets (CONFLICT) and enforces min-1 columns.
export interface UpdateProjectDto {
  name?: string;
  columns?: Column[];
}
