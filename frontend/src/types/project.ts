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
  isActive: boolean;
}

// Sent to POST /api/projects. slug is raw (service normalizes). columns optional.
export interface CreateProjectDto {
  name: string;
  slug: string;
  columns?: Column[];
}

// F27: PATCH /api/projects/:slug. Admin-only. Server blocks deleting a column
// that still has live tickets (CONFLICT) and enforces min-1 columns.
//
// isActive toggles a project between active/inactive. Inactive projects are
// hidden from normal listing but remain addressable by slug for admins.
// This field is gated to Platform Admins only on the backend: non-PAs cannot
// flip it and any such field in the payload is ignored/rejected.
export interface UpdateProjectDto {
  name?: string;
  columns?: Column[];
  isActive?: boolean;
}
