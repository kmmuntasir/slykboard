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
